# Humanitarian DataFlow

A small, working proof-of-concept demonstrating a humanitarian data-quality and
review workflow: **input data → validation → quality issues → human review →
resolution → simple report.**

This is a **portfolio/demo project**, not a production humanitarian
information-management platform. It uses a fictional organization
("Open Relief Network (Demo)") and a fictional country ("Republic of
Talvora") with synthetic data generated in the browser.

> **Demonstration system using fictional data only. Not intended for
> production humanitarian operations.**

## What it does

- **Dashboard** — record counts (processed / valid / warnings / errors /
  needs review / resolved) and an issue-count chart.
- **Import** — upload a CSV of service/activity records; parses and
  validates it on import, with a sample "dirty" CSV available to download
  for testing.
- **Review Queue** — every open data-quality issue, tracked **per issue**
  (not per record), so dismissing one warning on a record never hides an
  unrelated open issue on the same record.
- **Records** — a searchable list of all records.
- **Record Detail** — edit a record's fields and re-run validation; fixed
  issues disappear from the queue, unrelated issues stay.
- **Report** — a printable data-quality summary (uses the browser's native
  print dialog).

### Validation rules

- Required fields present
- Quantity greater than zero
- Valid activity/reported dates; activity date not in the future
- Timeliness: reported more than 30 days after activity → warning
- Duplicate `record_id` → error
- Project/location consistency → warning
- Cancelled status with a positive completed quantity → error

## Install and run locally

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (typically `http://localhost:5173`).

## Build for production

```bash
npm run build
```

Output is written to `dist/`.

## Preview the production build

```bash
npm run preview
```

## Notes

- No backend, database, or authentication — everything runs client-side.
  A generated synthetic dataset is created on first load.
- Imported data, edits, and issue statuses (open/dismissed/etc.) are kept in
  `localStorage` so they survive a page refresh or navigation. There is no
  server-side storage.
- Built with React, Vite, Tailwind CSS, Chart.js, and PapaParse.
