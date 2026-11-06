import {
  SMS_API_KEY,
  SMS_CLIENT_ID,
  SMS_SENDER_ID,
  SMS_PEID,
  SMS_OTP_TEMPLATE_ID,
  SMS_TEMPLATE_API_URL,
} from '../configs/env';

/**
 * SMS utility functions for STM Technologies SMS gateway.
 * Endpoint: POST https://sendsms.stmtechnologies.com/api/v2/SendSMS
 */

export interface SendSmsParams {
  mobileNumbers: string | string[];
  message: string;
  templateId?: string;
  is_Unicode?: boolean;
  is_Flash?: boolean;
}

export interface SmsSendResponse<T = any> {
  success: boolean;
  statusCode?: number;
  data?: T;
  message?: string;
  error?: string;
}

export type SmsTemplateSendResponse<T = any> = SmsSendResponse<T>;

/**
 * Send an SMS via the STM Technologies SendSMS endpoint.
 */
export async function sendSms(params: SendSmsParams): Promise<SmsSendResponse> {
  try {
    const apiKey = SMS_API_KEY;
    const clientId = SMS_CLIENT_ID;
    const senderId = SMS_SENDER_ID;
    const principleEntityId = SMS_PEID;
    const templateId = params.templateId || SMS_OTP_TEMPLATE_ID;

    if (!apiKey || !clientId || !senderId || !principleEntityId) {
      return {
        success: false,
        message:
          'SMS gateway configuration missing (SMS_API_KEY, SMS_CLIENT_ID, SMS_SENDER_ID, or SMS_PEID in env)',
      };
    }

    if (!templateId) {
      return {
        success: false,
        message: 'Template ID is required',
      };
    }

    if (!params.message) {
      return {
        success: false,
        message: 'Message content is required',
      };
    }

    const mobileNumbersStr = Array.isArray(params.mobileNumbers)
      ? params.mobileNumbers.join(',')
      : params.mobileNumbers;

    if (!mobileNumbersStr) {
      return {
        success: false,
        message: 'Mobile number(s) required',
      };
    }

    const payload = {
      senderId,
      is_Unicode: params.is_Unicode ?? false,
      is_Flash: params.is_Flash ?? false,
      message: params.message,
      mobileNumbers: mobileNumbersStr,
      principleEntityId,
      templateId,
      apiKey,
      clientId,
    };

    let apiUrl =
      SMS_TEMPLATE_API_URL ||
      'https://sendsms.stmtechnologies.com/api/v2/SendSMS';

    if (apiUrl.startsWith('http://sendsms.stmtechnologies.com')) {
      apiUrl = apiUrl.replace('http://', 'https://');
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[SMS SEND PAYLOAD]', payload);
    }

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

    if (process.env.NODE_ENV === 'development') {
      console.log('[SMS SEND RESPONSE]', responseData);
    }

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error:
          typeof responseData === 'string'
            ? responseData
            : JSON.stringify(responseData),
        message: `SMS API responded with status ${response.status}`,
        data: responseData,
      };
    }

    if (responseData && typeof responseData === 'object') {
      if (
        responseData.status === false ||
        responseData.status === 'Failed' ||
        responseData.success === false ||
        (responseData.statusCode && responseData.statusCode >= 400)
      ) {
        return {
          success: false,
          statusCode: responseData.statusCode || response.status,
          error:
            responseData.message || responseData.error || 'Failed to send SMS',
          message: responseData.message || 'Failed to send SMS',
          data: responseData,
        };
      }
    }

    return {
      success: true,
      statusCode: response.status,
      data: responseData,
      message: 'SMS sent successfully',
    };
  } catch (error: any) {
    console.error('[SMS SEND ERROR]', error);
    return {
      success: false,
      error: error?.message || 'Failed to send SMS',
      message: error?.message || 'Failed to send SMS',
    };
  }
}

/**
 * Execute Send SMS Template API.
 * Supports both options object or (templateId, mobileNumbers, message) parameter list.
 */
export async function smsTemplateSend(
  templateId: string,
  mobileNumbers: string[],
  message: string,
): Promise<SmsSendResponse> {
  const numbers = mobileNumbers || [];
  const msg =
    message || ''

  return sendSms({
    templateId,
    mobileNumbers: numbers,
    message: msg,
  });
}

export const smsUtils = {
  sendSms,
  smsTemplateSend,
};

export default smsUtils;
