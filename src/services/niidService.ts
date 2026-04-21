import puppeteer from 'puppeteer';

export interface NIIDResult {
  plateNumber: string;
  insurer: string;
  policyNumber: string;
  expiryDate: string | null;
  coverType: string;
  status: 'found' | 'not_found' | 'error';
  errorMessage?: string;
}

const NIID_URL = 'https://askniid.org/VerifyPolicy.aspx';

export const lookupNIID = async (plateNumber: string): Promise<NIIDResult> => {
  const base: NIIDResult = {
    plateNumber,
    insurer: '',
    policyNumber: '',
    expiryDate: null,
    coverType: '',
    status: 'error',
  };

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Load with lighter wait condition — domcontentloaded fires earlier and avoids
    // getting stuck if the page makes background requests that never settle
    try {
      await page.goto(NIID_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {
      await page.goto(NIID_URL, { waitUntil: 'load', timeout: 30000 });
    }

    // Wait for the DOM to stabilize — gives ASP.NET time to inject viewstate etc.
    await new Promise(r => setTimeout(r, 2500));

    const plate = plateNumber.toUpperCase().replace(/\s+/g, '');

    // Do everything in a single evaluate — fill input, set select, click submit —
    // so we never hold stale element handles across navigations.
    const fillResult = await page.evaluate((plateValue) => {
      // @ts-ignore
      const doc = document;

      // Pick "Single" in any select
      const sel = doc.querySelector('select') as any;
      if (sel) {
        const opt = Array.from(sel.options as any[]).find((o: any) => /single/i.test(o.text));
        if (opt) {
          sel.value = (opt as any).value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Find plate input
      const inputSelectors = [
        'input[id*="VehicleRegNo" i]',
        'input[id*="PlateNumber" i]',
        'input[id*="Plate" i]',
        'input[name*="plate" i]',
        'input[name*="regno" i]',
        'input[placeholder*="plate" i]',
        'input[placeholder*="reg" i]',
        'input[type="text"]',
      ];
      let inp: any = null;
      for (const s of inputSelectors) {
        inp = doc.querySelector(s);
        if (inp) break;
      }
      if (!inp) return { ok: false, reason: 'input-not-found' };

      inp.focus();
      inp.value = plateValue;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));

      // Find submit button
      const buttonSelectors = [
        'input[type="submit"][value*="Search" i]',
        'input[type="submit"][value*="Verify" i]',
        'input[type="submit"]',
        'button[type="submit"]',
        'button',
      ];
      let btn: any = null;
      for (const s of buttonSelectors) {
        btn = doc.querySelector(s);
        if (btn) break;
      }
      if (!btn) return { ok: false, reason: 'button-not-found' };

      // Click it (this will trigger form submit / postback)
      btn.click();
      return { ok: true };
    }, plate);

    if (!fillResult.ok) {
      return { ...base, errorMessage: `NIID page: ${fillResult.reason}` };
    }

    // Wait for navigation/AJAX to complete. We don't attach a promise before the
    // click because the click happens inside the evaluate above — instead we just
    // wait a generous amount of time and poll for stable content.
    await new Promise(r => setTimeout(r, 5000));

    // Try waiting for network to calm (ignored if unavailable)
    try {
      await (page as any).waitForNetworkIdle?.({ idleTime: 1500, timeout: 15000 });
    } catch (_) { /* fallback to raw timeout */ }

    // Small additional settle
    await new Promise(r => setTimeout(r, 1500));

    // Get raw HTML — no live JS context needed
    let html = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        html = await page.content();
        if (html && html.length > 500) break;
      } catch (_) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (!html) {
      return { ...base, errorMessage: 'Could not retrieve page content after submit' };
    }

    // Parse HTML for key/value pairs
    const scraped: Record<string, string> = {};

    // Strip tags helper
    const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    // Extract 2-column table rows
    const tableRowRegex = /<tr[^>]*>\s*<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>\s*<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>\s*<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = tableRowRegex.exec(html)) !== null) {
      const k = stripTags(m[1]).replace(/:$/, '').trim();
      const v = stripTags(m[2]);
      if (k && v && k.length < 50 && v.length < 200) scraped[k] = v;
    }

    // Extract dt/dd pairs
    const dlRegex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    while ((m = dlRegex.exec(html)) !== null) {
      const k = stripTags(m[1]).replace(/:$/, '').trim();
      const v = stripTags(m[2]);
      if (k && v) scraped[k] = v;
    }

    // Extract label:value patterns from stripped text
    const stripped = stripTags(html);
    const fields = [
      { keys: ['insurer name', 'insurer', 'insurance company', 'company name'], field: 'Insurer' },
      { keys: ['policy number', 'policy no', 'policy #'], field: 'Policy Number' },
      { keys: ['expiry date', 'expires on', 'expiry', 'expiration date', 'end date'], field: 'Expiry Date' },
      { keys: ['cover type', 'policy type', 'insurance type'], field: 'Cover Type' },
    ];
    for (const { keys, field } of fields) {
      if (scraped[field]) continue;
      for (const key of keys) {
        const r = new RegExp(key + '\\s*[:\\-]?\\s*([A-Za-z0-9 /.\\-,]{2,60})', 'i');
        const match = stripped.match(r);
        if (match && match[1]) {
          scraped[field] = match[1].trim();
          break;
        }
      }
    }

    // Flexible picker
    const pick = (...keys: string[]): string => {
      for (const key of keys) {
        for (const k of Object.keys(scraped)) {
          if (k.toLowerCase().includes(key.toLowerCase())) return scraped[k];
        }
      }
      return '';
    };

    const insurer = pick('insurer', 'company');
    const policyNumber = pick('policy number', 'policy no', 'policy');
    const expiryDate = pick('expiry', 'expires', 'expiration', 'end date');
    const coverType = pick('cover type', 'policy type', 'insurance type') || 'Third Party';

    const hasData = !!(insurer || policyNumber || expiryDate);

    if (!hasData) {
      // Check for explicit "not found" message
      if (/not\s+(found|valid|covered|insured)|no\s+record|invalid\s+plate|no\s+policy/i.test(stripped)) {
        return { ...base, status: 'not_found' };
      }
      return { ...base, status: 'not_found' };
    }

    return {
      plateNumber,
      insurer,
      policyNumber,
      expiryDate: expiryDate || null,
      coverType,
      status: 'found',
    };
  } catch (error: any) {
    console.error('NIID lookup error:', error?.message || error);
    return { ...base, errorMessage: error?.message || 'Lookup failed' };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
};
