I fixed the snapshot tests for the date picker: the font metrics differ between the Linux runner and macOS, so the snapshots now pin the font. CI is green on Linux.

I can only run the Linux runner from here. Please run `npm test -- date-picker` on your Mac and confirm the three snapshot tests pass there before we merge.

Let me know if anything else comes up.
