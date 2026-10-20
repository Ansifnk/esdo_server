/**
 * SMS utility functions for STM Technologies SMS gateway.
 */



export interface SmsTemplateSendResponse<T = any> {
  success: boolean;
  statusCode?: number;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Execute Send SMS Template API.
 * Endpoint: POST https://sendsms.stmtechnologies.com/api/v2/Template
 *
 * apiKey and clientId are retrieved from environment variables by default
 * (SMS_API_KEY / SMS_CLIENT_ID), or can be passed directly via params.
 */

export async function smsTemplateSend(
  templateId: string,
  mobileNumbers: string[]
): Promise<SmsTemplateSendResponse> {
  try {

    const apiKey = process.env.SMS_API_KEY;
    const clientId = process.env.SMS_CLIENT_ID;
    const senderId = process.env.SMS_SENDER_ID



    if (!apiKey || !clientId || !senderId) {

      return {
        success: false,
        message: 'API key or client or senderId ID not found',
      }
    }

    const payload = {

      senderId,
      is_Unicode: false,
      is_Flash: false,
      // dataCoding: 0,
      // schedTime: "string",
      // groupId: "string",
      mobileNumbers: mobileNumbers.join(', '),
      // serviceId: "string",
      // coRelator: "string",
      // linkId: "string",
      principleEntityId: "string",
      templateId,
      apiKey,
      clientId
    };

    const apiUrl =
      process.env.SMS_TEMPLATE_API_URL ||
      'https://sendsms.stmtechnologies.com/api/v2/Template';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        accept: 'text/plain',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: typeof responseData === 'string' ? responseData : JSON.stringify(responseData),
        message: `SMS template API responded with status ${response.status}`,
        data: responseData,
      };
    }

    return {
      success: true,
      statusCode: response.status,
      data: responseData,
      message: 'SMS template request executed successfully',
    };
  } catch (error: any) {
    console.error('[SMS TEMPLATE SEND ERROR]', error);
    return {
      success: false,
      error: error?.message || 'Failed to send SMS template',
      message: error?.message || 'Failed to send SMS template',
    };
  }
}

export const smsUtils = {
  smsTemplateSend,
};

export default smsUtils;
