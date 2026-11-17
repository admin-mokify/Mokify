# Mokify

Landing page for **Mokify**, a peer learning platform where students help each other study. Schools adopt the platform; it's always free for students.

## Stack

Static site, no build step: plain HTML, CSS, and vanilla JavaScript.

## Project structure

```
index.html          Landing page
assets/css/         Styles (style.css)
assets/js/          Behavior (main.js) — mobile nav, scroll reveals, the "how it works" scrolly section
assets/img/         Logo and photography used on the site
```

## Checking teachers' documents

`tikrinimas.html` is where Mokify approves or rejects the diplomas and TAMO grades that teachers upload. Only accounts listed in the `public.reviewers` table can open it (the account page shows them a "Dokumentų tikrinimas" button); for everyone else the database returns nothing. The first reviewer is @boomroob.

- Waiting documents are listed oldest first. Opening one shows the file inside the page (a picture or a PDF) with who sent it, their school, class and subjects.
- "Patvirtinti" or "Nepatvirtinti", optionally with a note the student sees. The next waiting document opens by itself. A decision can be changed later from the other two tabs.
- A reviewer can't decide on their own documents.
- The student gets a notification and sees the outcome (and the note) on their account page. Reviewers get a notification when new documents are waiting.
- Every decision is also kept in `public.document_reviews` (who decided what, when), readable only in Supabase.
- Adding or removing a reviewer is done in the Supabase SQL Editor; the commands are at the top of `supabase/updates/2026-11-18-document-review.sql`.

## Meetings (video calls)

`susitikimai.html` lets students meet in a video call to study together: camera, microphone, screen sharing, chat, raising a hand.

```
susitikimai.html                         The page: start, camera check, the call
assets/js/meet.js                        The call itself (WebRTC)
supabase/updates/2026-11-13-meetings.sql Who may be in a meeting; every rule is enforced here
functions/api/ice.js                     Server code (Cloudflare Pages) that hands out relay servers
```

How it stays safe:

- Only signed-in students of a school with a running subscription get in. A link alone is useless.
- Everyone except the organizer waits until the organizer lets them in, and is shown with their real name, class and school. The organizer can refuse, remove, lock and end.
- Students who blocked each other are never put in the same meeting.
- Sound and picture are encrypted between the browsers and never stored. Nothing is recorded.
- Calls go through a relay server, so students never learn each other's network (IP) address. Without a relay a call doesn't start at all.
- The camera and microphone are off until the student switches them on, and no other page of the site can use them (`_headers`).
- Any participant can report another one. Reports land in the `meeting_reports` table; nobody is notified automatically, so someone has to look.
- A meeting holds up to 6 students and its link works for 24 hours. Who took part and the meeting's chat are deleted 30 days after it ended.

### Lessons (one-on-one)

`pamoka.html` is the same call for one teacher and one student, arranged in their chat (`zinutes.html`) and nowhere else:

- The camera button in a chat invites to a lesson right now; the other student gets a card with a "Prisijungti" button. The calendar button proposes a day and time (at most a year ahead), which the other accepts or declines.
- An agreed lesson opens by itself 10 minutes before its time and stays open for 3 hours after it.
- Only those two students can enter, with or without the address. The teacher of the two always leads the call.
- Either student can call an agreed lesson off before it starts (with a warning); moving it to another time needs both to agree.
- Late: from 10 minutes after the start the student who came may call it off; at 15 minutes it ends 60 seconds later unless the other arrives; if nobody came it ends at 15 minutes.
- Rules: `supabase/updates/2026-11-14-lessons.sql` and the later files in that folder.

### Notifications

Signed-in students get notifications in the top right corner of every page (only inside the website, not the computer's or phone's own notifications): new messages (unless that conversation is open and scrolled to the bottom), lesson requests, and lesson moments (can join, the other joined, 5 / 10 minutes late, ended because of being late). After being away, the messages are summed up in one notification. The database side is `public.my_notifications`; the website side is `initNotifications` in `assets/js/main.js`.

Setting it up (once):

1. **Supabase**: SQL Editor → paste and Run each file in `supabase/updates/` from `2026-11-13-meetings.sql` on, oldest date first, once each. The top of that file also lists the commands for reading reports and for switching all meetings off at once.
2. **Cloudflare**: create a TURN key and give it to the site as two secrets. The steps are at the top of `functions/api/ice.js`. Until this is done the page says meetings are unavailable.
3. Deploy. The function only runs on Cloudflare Pages.

Running the site locally (below) also works for trying a call between two browser tabs on the same computer: there the browsers connect directly, without a relay.

## Running locally

No build tools required — just serve the folder statically, e.g.:

```bash
npx http-server -p 5500 -c-1 .
```

Then open `http://localhost:5500`. This matches the `mokify-static` launch configuration in `.claude/launch.json`.
