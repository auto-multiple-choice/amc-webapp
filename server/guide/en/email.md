# Email results

## What to do here

- Check the email column, where replies go, and the message.
- Look at a student's email in the preview, and send yourself a test.
- Choose the students, then send. Each one gets their annotated sheet and mark.

## What this step is for

Giving each student their annotated sheet and mark by email, instead of on paper. It opens from **Annotate › Email the sheets to students**, once the sheets are annotated.

## Before you start

- **The mail server is set up** by an administrator, once for the whole server, in **Email sending** (the account menu). On a single computer you are the administrator: the screen offers the setup.
- **The class list has an email column**, loaded in Match students, and the sheets are matched to students.
- **One PDF per student** is chosen in Annotate › Files, and the sheets are annotated and up to date.

## How to do it

1. **Email column**: the class list column with the addresses. A column called "email" is found by itself. A cell may hold several addresses, separated by commas or semicolons.
2. **Replies go to**: your own address. Emails come from the server's sender address; students who reply reach you.
3. **Subject** and **Message**: the text, with the same codes as the annotated sheets' header: `%s` the mark, `%m` what it is out of, `%S` points, `%M` maximum points, `%n` the exam, `%(ID)` the student's name, and `%(name)`, `%(roll_no)` or any other class list column. The **Insert** buttons add them where the cursor is.
4. **Preview**: choose a student to see their email as it will be sent, and open the attached sheet.
5. **Send me this as a test**: sends that student's email to your address, with [Test] in the subject.
6. **Students**: everyone who can get an email is ticked, except those sent one already. Press **Send emails…** and confirm. Progress shows as each email goes; **Stop** stops after the current one.

Each student's status is kept: **Sent** with the time, or **Failed** with the reason. Sending again later only ticks those not reached yet.

## Common problems

**"No email address" or "Not an email address".** Fix the class list and load it again in Match students.

**"Not matched to a student".** Match the sheet in Match students.

**"No annotated sheet".** Annotate again, with **One PDF per student**.

**The mail server refused the user name or password.** Ask the administrator to check Email sending (for Gmail, an app password is needed).

**A daily limit is reached.** The server sends a set number of emails a day per teacher. Send the rest tomorrow.
