import axios from 'axios';

const PAYSTACK_BASE = 'https://api.paystack.co';
const headers = {
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
};

export const initializeTransaction = async (params: {
  email: string;
  amount: number;
  reference: string;
  metadata?: Record<string, unknown>;
  callback_url?: string;
}): Promise<{ authorizationUrl: string; reference: string; accessCode: string }> => {
  const response = await axios.post(
    `${PAYSTACK_BASE}/transaction/initialize`,
    {
      ...params,
      amount: Math.round(params.amount * 100),
    },
    { headers }
  );
  const { authorization_url, reference, access_code } = response.data.data;
  return { authorizationUrl: authorization_url, reference, accessCode: access_code };
};

export const verifyTransaction = async (reference: string): Promise<{
  status: string;
  amount: number;
  metadata: Record<string, unknown>;
}> => {
  const response = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${reference}`, { headers });
  const { status, amount, metadata } = response.data.data;
  return { status, amount: amount / 100, metadata };
};
