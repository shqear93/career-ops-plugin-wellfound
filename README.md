# career-ops-plugin-wellfound

A [career-ops](https://github.com/santifer/career-ops) plugin that scrapes Wellfound's job search page to surface global-remote engineering roles.

## Install

```bash
node plugins.mjs add shqear93/career-ops-plugin-wellfound --sha <commit-sha>
```

## Setup

Add a `WELLFOUND_COOKIE` to your `.env` for authenticated results (optional but recommended):

```
WELLFOUND_COOKIE=<your-session-cookie>
```

To get your session cookie: log in to wellfound.com → DevTools → Application → Cookies → copy the session cookie value.

## portals.yml

```yaml
tracked_companies:
  - name: Wellfound Remote Engineering
    provider: wellfound
    searchUrl: "https://wellfound.com/jobs?remote=true&keywords=platform+engineer&locationSlugs[]=everywhere"
    enabled: true
```

## Notes

- Returns only **global-remote** jobs (`Remote · Everywhere`)
- `company` field is blank — employer name can't be reliably extracted from the listing page HTML
- Without a session cookie, Wellfound may return empty results (login wall)

## License

MIT
