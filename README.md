# Assignment 13 — Class Booking

## The scenario

Picture a fitness or dance studio running a weekly slate of classes across a few rooms and several
instructors, with members signing up ahead of time for whichever sessions fit their schedule. Right
now sign-ups happen on a sheet taped to the studio door or a shared spreadsheet, membership expiry
dates live in a separate binder at the front desk, and whether a popular class is actually full is
whatever the instructor remembers from the last headcount.

The result is predictable. Two members claim the last open spot in the same class within minutes of
each other, and the room ends up over capacity because the sheet was only updated once. A spot opens
up when someone cancels, but nobody thinks to check the binder for who was waiting, so the spot sits
empty through a class other people wanted into. A member whose membership lapsed months ago still
turns up and books a class, and nobody finds out until the front desk happens to flip to the right
page.

They want one system: studio staff schedule classes and their sessions, track each member's
membership status, and let a cancellation automatically pull the next person off the waitlist so a
freed spot never sits empty. Instructors see their own sessions and record who actually showed up.
Build the system that replaces the sign-up sheet and the binder both.

## What it must do

Everything below is required. Several of the ten spell out exact rules — what happens on an illegal
move, what a bulk action must report back, when a dismissed alert is allowed to reappear — and those
specifics are the actual ask, not just the bold headline in front of them.

1. **Accounts and roles.** People sign in with an email and password, and there are at least two
   roles — a studio staff role and an instructor role. Studio staff create and archive classes, schedule
   sessions with a room and a primary instructor, add members and set their membership expiry, and can
   create, cancel or settle a booking for any session. Instructors can only see and act on sessions
   where they are the primary instructor or a co-instructor, and cannot create classes, sessions,
   members or bookings. The difference must be enforced on the server, not just hidden in the interface.

2. **Classes.** Studio staff create classes with a title, a description, a discipline, a default
   duration, and a default capacity, and can edit them later. Classes can be archived and restored.
   Archiving hides a class from the default views without destroying its sessions or bookings.

3. **Sessions inside classes.** Every session belongs to exactly one class and carries a date, a
   start time, a primary instructor, a room, a duration, and a capacity — the duration and capacity
   each default from the class but can be changed per session. Sessions can be created, edited, and
   deleted by studio staff. Opening a class shows its sessions.

4. **A booking lifecycle with rules.** Each booking is for a member — tracked with a name, an email,
   and a membership expiry date — attending one class session, and succeeds directly to _Booked_ if the
   session has capacity remaining or is placed as _Waitlisted_ if the session is full. A member whose
   membership expiry date has passed cannot create a new booking. A Booked or Waitlisted booking can be
   marked _Cancelled_; cancelling a Booked booking automatically promotes the earliest Waitlisted
   booking on that session to Booked. Once the session's scheduled time has passed, a Booked booking is
   settled as _Attended_ or _No Show_. Any other move must be rejected by the server with a message
   explaining why.

5. **Co-instructors.** A session has one primary instructor, but any number of other instructors can
   be added to it as co-instructors, and a single instructor can be added this way to any number of
   sessions. Only studio staff can add or remove a co-instructor. Every instructor can see one list of
   every session where they are the primary instructor or a co-instructor.

6. **Finding bookings.** One list shows bookings across every session the viewer can see, with a text
   search over member name and email, filters for class, session and status, sorting by booked time,
   status or session, and pagination showing the total number of matches. All of this must happen on the
   server — do not load every booking into the browser and filter there.

7. **Generating a recurring schedule.** Studio staff can bulk-generate class sessions for a class
   across a date range from a recurring weekly pattern — the same class, instructor, room and start
   time repeated each week, for example. The result reports which sessions were created and which were
   skipped because the chosen instructor or room was already booked in an overlapping window.
   Separately, export a session's attendance — every booking with its member and final status — as a CSV
   file.

8. **A dashboard.** A landing view shows headline numbers — sessions today, bookings made today,
   no-shows this week, and members currently waitlisted. It also breaks bookings down by status and by
   class, and charts attendance per week over the last eight weeks.

9. **History you cannot rewrite.** Every booking has a timeline showing when it was created, every
   status change with the old and new status and who made it, and any notes staff leave about it.
   Nothing in this timeline can be edited or deleted after the fact, including by studio staff.

10. **Expiring membership alerts.** Any member whose membership expiry date falls within the next
    seven days, or has already passed, appears in an alerts area, with a count badge visible in the
    navigation. Studio staff can dismiss the alert. If staff set a new, later expiry date and that date
    later falls within seven days again, the alert returns.

## Stretch ideas (optional)

None of these are required, and none substitute for a goal above. If you finish all ten with time
left over, pick whichever of these sounds most useful and build it:

- Online self-service booking for members.
- Automated reminder messages before a session.
- Package or credit-based membership pricing.
- Substitute-instructor swaps with advance notice.
- Recurring bookings across an entire term.
- A public class schedule page.
- Waitlist position visibility for members.
- Instructor payroll based on sessions taught.
- Room utilization reporting.

---

## What we are assessing

A working application is table stakes. Almost every serious candidate will produce something that runs, has a login, and roughly does what was asked. That's the floor, not the differentiator.

What actually separates submissions is the record of thinking behind the app: the decisions you made and why, the trade-offs you weighed, what you built first and what you deliberately left out, and whether you can explain any part of your own system when asked. We are hiring for judgement. The app is the evidence for that judgement, not the deliverable in itself.

We also read the code itself for structure and readability, which counts for a small share of the overall score.

## Time budget

Budget about 12 hours total, spent roughly 2 hours a day across a week.

This is not a race. We are not timing you against other candidates, and submitting early scores nothing extra. Twelve hours is a size guide so you know how much to attempt — pace yourself, stop when you're tired, and spend some of that time thinking and documenting, not only typing code.

## Pick any stack you like

Use any language, any framework, any UI library, any ORM, and any database access approach you want. We have no house stack, and no stack scores better than another — this round is not a test of whether you know particular tools.

Use whatever you are fastest and most confident in. Time spent learning something new to impress us is time not spent on the ten goals above, and it will show.

## Using AI is allowed and encouraged

Use AI tools however you want — to scaffold code, debug a stuck problem, write tests, draft documentation, or anything else that helps you move faster. A few things to know about how we treat it:

- We do not penalise AI use, and we make no attempt to detect it.
- We care about whether you understood, directed and verified the output — not about who or what produced the first draft of it.
- `docs/ai-prompts.md` must contain the prompts you actually used, including the ones that produced bad output and what you changed afterwards. If you used no AI at all, say so here and describe how you worked instead — that is assessed the same way.
- Submitting generated code you cannot explain is the single most common way candidates fail this round.

You are accountable for everything in your submission. If a reviewer points at a piece of code and asks why it's there, or why it works the way it does, "the AI wrote it" is not an answer.

## Use git properly

Publish to a public GitHub repository, and commit incrementally as the work actually happens — after each meaningful step, not in one pass at the end.

A repository whose entire history is a single "initial commit" containing a finished app scores zero on git history, and it colours how we read everything else in your submission, however good the app itself is. Your history is how we see the order you built in, where you got stuck, and how the design changed along the way. If it isn't there, we can't assess it, and we won't assume the best.

## What you must commit

Alongside your code, commit these five files under `docs/`. Your zip includes a stub for each with the questions it needs to answer — fill them in as you go, not from memory at the end.

| File                   | What it must answer                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md` | What the moving pieces are, how they talk to each other, where each one runs, the request path for one representative user action end to end, and what you decided not to build.                                                          |
| `docs/schema.md`       | Every table's columns and types, which relationships are one-to-many versus many-to-many, which constraints live in the database versus the application, what you deliberately denormalised, and what would break first at 100x the data. |
| `docs/plan.md`         | How you split the work into sessions, what order you built in and why, what you estimated versus what it actually took, and what you cut when you ran short.                                                                              |
| `docs/decisions.md`    | At least five real decisions — what you chose, what you rejected, and why — including at least one you later reversed.                                                                                                                    |
| `docs/ai-prompts.md`   | The prompts you actually used, in order, grouped by what you were trying to do, including at least one that produced something wrong and what you did about it.                                                                           |

## Host it for free

Deploy the whole thing somewhere reachable by URL, using free tiers only.

One combination that works, if you would rather not decide:

- **Database** — a managed service such as Supabase.
- **Server-side code** — Render.
- **Browser-side code** — Vercel.

Deploy in that order: create the database first, give the server its connection details as environment variables, then point the browser-side part at the server's public URL.

This is one option, not a requirement. Any free host is equally acceptable — everything on a single provider, one virtual machine, a container platform, a static host with serverless functions. The choice earns and loses nothing.

Requirements:

- A working live URL.
- Seeded with enough demo data to show the system doing something, not an empty shell.
- Demo credentials for every role recorded in `SUBMISSION.md`.
- Connection strings, keys and passwords kept in environment variables, never in the repository.
- Free tiers often sleep when idle and can take a minute or more to wake. Note it in `SUBMISSION.md` if yours does, so a slow first load is not read as a broken deployment.
- If you cannot get it hosted, submit anyway and record in `SUBMISSION.md` what you tried and where it broke.

## How to submit

Send us:

- The URL of your public GitHub repository.
- The URL of your live, deployed application.
- Your completed `SUBMISSION.md`, committed to the repository.

That's the whole submission. Nothing else to prepare, no separate form.

## What happens next

If your submission clears the bar, we'll set up a short call. We will ask about specific decisions we can see in your repository and its history — why you modelled something a particular way, what a certain commit was fixing, what you'd change if you kept going.

We're telling you this now because it should change how carefully you document as you go. Write `docs/decisions.md` for a version of yourself who has to explain it three weeks from now.

## Scope

The 10 goals stated in this brief are the cutoff. Meet all 10, solidly, and you have a complete submission.

Stretch ideas are optional. They exist for candidates who finish the 10 with time left and want to keep building — they are never required, and they do not make up for a goal you didn't hit. Doing 8 goals well beats doing 10 goals badly. If time is short, finish fewer goals properly rather than leaving all ten half-done.
