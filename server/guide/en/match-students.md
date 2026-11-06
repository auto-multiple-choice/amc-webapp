# Match students

## What to do here

- Load the class list: a CSV file with column names on the first line and one student per line.
- Choose the column with the student code, then match automatically if the papers have code boxes.
- Match the other sheets by hand: type part of the name written on the sheet, then press Enter.

## What this step is for

Linking each answer sheet to a student, so marks are exported with names.

## How to do it

1. Load the class list. For example:

```
id,surname,name
1001,Curie,Marie
1002,Noether,Emmy
```

2. Choose the **column with the student code**: a different value for every student.
3. If the papers have student code boxes, choose the code on the sheet and press **Match automatically**. This needs the marks to be computed first.
4. For each remaining sheet, read the name in the name field, type part of it, and press **Enter**.

A sheet can also be marked **Not in the class list**, or put **Back to automatic**. Matching a student who is already on another sheet moves them; that sheet goes back to the sheets to match.

## Common problems

**"The class list can't be read".** Save it as CSV (UTF-8) from your spreadsheet, with column names on the first line.

**No column can be chosen.** A code column needs a different, non-empty value for every student. Add a student number column.

**A code doesn't match.** Leading zeros don't count (0123 matches 123). Check what the student wrote: the page shows the code read on the sheet.
