import axios from 'axios';
import { env, getEbayApiBaseUrl } from '../../config/env.js';
let cachedToken = null;
export async function getEbayAccessToken() {
    if (cachedToken && Date.now() < cachedToken.expiresAt)
        return cachedToken.accessToken;
    const credentials = Buffer.from(`${env.EBAY_APP_ID}:${env.EBAY_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
    });
    const response = await axios.post(`${getEbayApiBaseUrl()}/identity/v1/oauth2/token`, body.toString(), {
        headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });
    cachedToken = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in - 60) * 1000,
    };
    return cachedToken.accessToken;
}
