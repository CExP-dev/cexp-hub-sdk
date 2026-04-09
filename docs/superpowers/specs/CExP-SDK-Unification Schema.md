# CExP HUB SDK Unification Schema

```json
{
  "version": "string",
  "sdkId": "cexp-01234",
  "modules": [
    {
      "id": "notification-001",
      "type": "NOTIFICATION",
      "property": {
        "appId": "string; //uuid of namespace",
        "autoResubscribe": true,
        "serviceWorkerEnabled": true,
        "serviceWorkerPath": "string",
        "serviceWorkerParam": "string",
        "notificationClickHandlerMatch": "string",
        "notificationClickHandlerAction": "string",
        "persistNotification": false,
        "promptOptions": {
          "slidedown": {
            "prompts": [
              {
                "type": "'push' | 'category'",
                "autoPrompt": true,
                "delay": {
                  "pageViews": "number | string",
                  "timeDelay": "number | string"
                },
                "text": {
                  "actionMessage": "string",
                  "acceptButton": "string",
                  "cancelButton": "string"
                }
              }
            ]
          }
        }
      }
    },
    {
      "id": "gamification-001a",
      "type": "GAMIFICATION",
      "property": {
        "packageVersion": "string",
        "clientKey": "string",
        "tokenBaseUrl": "string"
      }
    }
  ]
}
```

**`promptOptions.slidedown.prompts[].delay`:** `pageViews` and `timeDelay` may be JSON **numbers** or **numeric strings** from the backend; the SDK coerces them to **numbers** before calling `OneSignal.init`.
