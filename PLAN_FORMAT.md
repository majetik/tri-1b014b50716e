# Training plan format

Give this file to the conversation that writes the training plan. Ask it to return one complete JSON document for `docs/plan.json`.

The app reads that file each time it loads. Changing the plan needs no code change. If the file is invalid, the app shows the error and falls back to its default ramp.

## Rules

- Output valid JSON only, with no comments.
- Race date is `2027-10-17`, a Sunday. Its week starts on `2027-10-11`.
- `planStart` is the first day of the real plan. Before it, the app shows "Ramp-up" and does not mark you behind.
- `rampStart` is the first day of ramp-up. Older activities appear faded as history.
- Every `weekOf` must be a Monday in `YYYY-MM-DD` format, and may appear only once.
- Any week left out uses the app's default ramp, so a partial plan is fine.
- `swim`, `bike`, and `run` are target **hours** for that week. If omitted, the app adds up that week's `sessions`.
- `sessions` are optional. When present, they replace the app's generated next steps for that week.
- Session `sport` must be one of `swim`, `bike`, `run`, `strength`, `climbing`, `other`.
- Session `day` is optional and must be one of `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun`.
- Session `title` and `minutes` are required. `detail` is optional.
- This file is public. Do not include personal, medical, or location details.

## Example

```json
{
  "rampStart": "2026-11-23",
  "planStart": "2026-12-07",
  "weeks": [
    {
      "weekOf": "2026-12-07",
      "phase": "Base",
      "swim": 1.5,
      "bike": 2.5,
      "run": 1.5,
      "sessions": [
        { "day": "Tue", "sport": "swim", "title": "Technique swim", "minutes": 45, "detail": "Drills, then 6 x 50 m easy." },
        { "day": "Wed", "sport": "strength", "title": "Full-body strength", "minutes": 40 },
        { "day": "Thu", "sport": "run", "title": "Easy run", "minutes": 35, "detail": "Zone 2." },
        { "day": "Sat", "sport": "bike", "title": "Long ride", "minutes": 90, "detail": "Steady Zone 2." }
      ]
    }
  ]
}
```

## Update the plan

Replace the contents of [docs/plan.json](https://github.com/majetik/tri-1b014b50716e/edit/main/docs/plan.json) on GitHub and commit. The app updates about a minute later.
