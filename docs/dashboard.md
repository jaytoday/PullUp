# The dashboard

PullUp's web app (port 3500 in development). Sign in with the owner account; the first account
created owns the instance. ([Back to the overview](README.md))

| Page | What it shows |
| --- | --- |
| **Overview** | Runs in the last day, the share that reached the council, cost, runs waiting for a person, recent runs. |
| **Runs** → a run | The steps of the run, hard failures with their logs, each question grouped by extension with every reviewer's answer and the quotes that checked out, Shadow questions as "would ask", notes and file findings for the reviewer, and the record with whether its chain is intact. |
| **Questions** | Questions waiting for a person right now. |
| **Accuracy** | How often the council's lean matched the person's answer, per kind of question (filter by extension); what the council would do with Shadow extensions' questions; cost per day. |
| **Settings** | Per repository: Shadow or Active, and **Extensions** (below); the result of the daily threat model check; the stop switch. |
| **Set up a repo** | A guided form that builds `.pullup/config.json`: workflows, who to ask, a starting set of extensions (Essentials or Security), the core checks' settings. |

## Settings → Extensions

Every extension, per repository, with Off · Shadow · Active and a **Settings** button that opens a form
built from the extension's list of settings. Changes are saved as a **draft** of the config file
(PullUp never writes to the repository); the page shows the file to commit. A change that loosens
PullUp needs "loosen" typed before it can be saved. "Discard draft" goes back to what is committed.

Nothing here is animated: these are settings people read carefully.
