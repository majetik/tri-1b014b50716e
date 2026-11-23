# Ironman 70.3 Tracker

Phone-first training tracker for the race on October 17, 2027. The site runs on GitHub Pages. A Cloudflare Worker holds the Garmin key and serves live data.

## Set up

1. Create a free Cloudflare account, then log in:

   ```bash
   npx wrangler login
   ```

2. Set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your GitHub Pages origin.

3. Store your Garmin key as a Cloudflare secret. Paste it only at the prompt:

   ```bash
   npx wrangler secret put GARMIN_API_KEY --config worker/wrangler.toml
   ```

4. Deploy the Worker:

   ```bash
   npx wrangler deploy --config worker/wrangler.toml
   ```

5. Put the Worker URL in `docs/config.js`.

6. Push this folder to GitHub. In the repo, open Settings, then Pages, and serve from the `main` branch `/docs` folder.

## Privacy

The Worker's `/data` response and the site are public. The Worker publishes an allowlist of training fields plus recent sleep and HRV. It never publishes GPS, place names, activity titles, weight, nutrition, or women's health data. To change this, edit `ACTIVITY_FIELDS` in `worker/index.js`.

## Change the plan

Edit weekly hours in `SPORTS` at the top of `docs/logic.js`.

## Test

```bash
npm test
```
