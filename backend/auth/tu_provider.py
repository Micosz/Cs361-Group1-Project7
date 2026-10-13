"""#75 compatibility bridge: invoke the existing Node TU adapter using AWS IAM.

Only backend credentials can invoke Lambda. Browser profiles never enter linking.
The Node function owns the TU endpoint/key/HTTP/status/type/timeout validation.
"""
import json
from .session_service import AuthError


class LambdaTuProvider:
    def __init__(self, client, function_name):
        if function_name != 'tuAuthLogin':
            raise ValueError('Unexpected TU adapter function')
        self.client, self.function_name = client, function_name

    def authenticate(self, username, password):
        try:
            result = self.client.invoke(FunctionName=self.function_name,
                InvocationType='RequestResponse',
                Payload=json.dumps({'httpMethod': 'POST', 'body': json.dumps(
                    {'UserName': username, 'PassWord': password})}).encode())
            if result.get('FunctionError') or result.get('StatusCode') != 200:
                raise ValueError()
            envelope = json.loads(result['Payload'].read())
            body = json.loads(envelope['body'])
            status = envelope['statusCode']
        except Exception:
            raise AuthError('AUTH_PROVIDER_UNAVAILABLE', 503) from None
        if status != 200:
            codes = {'INVALID_CREDENTIALS': 401, 'INVALID_REQUEST': 400,
                     'AUTH_PROVIDER_INVALID_RESPONSE': 502, 'AUTH_CONFIGURATION_UNAVAILABLE': 503,
                     'AUTH_PROVIDER_UNAVAILABLE': 503, 'RATE_LIMITED': 429}
            code = body.get('code') if isinstance(body, dict) else None
            if code not in codes or codes[code] != status:
                raise AuthError('AUTH_PROVIDER_UNAVAILABLE', 503)
            raise AuthError(code, status)
        user = body.get('user') if isinstance(body, dict) else None
        if (not isinstance(body, dict) or body.get('success') is not True or not isinstance(user, dict)
                or user.get('username') != username or user.get('type') not in {'student', 'employee'}
                or any(not isinstance(user.get(k, ''), str) for k in
                       ('displayname_th', 'displayname_en', 'email'))):
            raise AuthError('AUTH_PROVIDER_INVALID_RESPONSE', 502)
        return user
