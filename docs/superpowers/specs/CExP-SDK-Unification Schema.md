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
                  "pageViews": "number",
                  "timeDelay": "number"
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
