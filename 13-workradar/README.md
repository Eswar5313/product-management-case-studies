# WorkRadar

A manager's daily view of team work across Slack, Jira, GitHub and Email. MVP on mock data.

It answers four questions on one screen: top work for the day, what happened today, what needs immediate attention, and who is blocked.

**Live demo:** https://eswar5313.github.io/product-management-case-studies/13-workradar/

Documents: [PRD](docs/WorkRadar_PRD.pdf) · [AI workflow](docs/WorkRadar_AI_Workflow.pdf) · [Demo script](docs/WorkRadar_Demo_Script.pdf) · [Video master](docs/WorkRadar_Video_Master.pdf) · [Screens](screens/)

## Run it

Open `index.html` in any modern browser. There is no build step, server or sign-in.

To rebuild `index.html` after editing files in `src/`:

    python3 build.py

## Features

- Dashboard: brief, radar, Needs you now, Top work today, Who is blocked, What happened today
- AI-generated brief: inside Claude the "Write with Claude" button sends the ranked items to the model; everywhere else a rule-based summary is shown and labelled
- Priority feed: one ranked list with filters for status, lens and tool
- Item details: digest, suggested next step, thread, and the score breakdown
- Search across all tools, including done and snoozed items (press `/`)
- Actions: Assign, Mark done, Snooze, each with Undo
- Empty and error states; use "Simulate Jira outage" in the sidebar to see the sync-failure state
- Light and dark themes, phone layout

## Structure

    index.html        built app (inlined CSS and JS)
    build.py          inlines src/ into index.html
    src/data.js       mock data: 17 items, 9 events, 6 teammates (all fictional)
    src/app.js        priority score, views, actions, state
    src/styles.css    design tokens and layout
    src/body.html     page shell
    docs/             PRD, AI workflow and demo script (PDF)
    screens/          screenshots of every screen and state

## Priority score

Additive and capped at 99. Base points by type (incident 58, blocker 34, decision 28, review 22, risk 20, planned work 12, FYI 4), plus points for due date, a blocked teammate, customer impact, waiting on the manager, release dependency and missing owner. Critical is 70+, High 48 to 69, Medium 28 to 47, Low below 28. See `score()` in `src/app.js`.

## Limits

Prototype only. Mock data, single user, state saved in the browser's localStorage. Item digests are pre-written sample text. No connectors, authentication, backend or security review.

## Licences

Fonts (Fraunces, IBM Plex Sans, IBM Plex Mono) load from Google Fonts under the SIL Open Font License. The app uses no third-party JavaScript.
