KOREAN VISUAL VOCABULARY — V1.2
Spaced Repetition edition

NEW IN V1.2
- Spaced repetition review queue
- Every vocabulary item has:
  dueAt, intervalDays, ease, repetitions, lapses, lastReviewedAt
- Old V1/V1.1 words remain compatible and are treated as due immediately
- Dashboard shows how many words are due now
- Review defaults to "Spaced repetition · Due now"
- After revealing/checking an answer, choose:
  Again / Hard / Good / Easy
- Each button shows the next interval before you choose it
- Again schedules the word again in about 10 minutes
- Hard / Good / Easy progressively increase the interval
- Existing random/all review remains available
- Export/import preserves spaced-repetition progress

HOW TO UPDATE YOUR EXISTING GITHUB PAGES SITE
1. Open your repository: Kyriel-lab/korean-visual-vocab
2. Add file → Upload files
3. Upload ALL files from this V1.2 folder
4. Replace files when GitHub prompts
5. Commit changes
6. Wait 1–3 minutes
7. Open the GitHub Pages website
8. Press Ctrl + Shift + R once

IMPORTANT
- Your vocabulary data is stored in browser IndexedDB, not in the repository.
- Updating the website files should not erase existing vocabulary.
- Export a JSON backup before major browser/storage changes.
- GitHub Pages + installed PWA on the same site origin use the same underlying site storage.
- Data still does not automatically sync between different devices.

SRS MODEL
This is a lightweight SM-2-inspired scheduling model, intentionally kept simpler than Anki/FSRS.
It is designed for a personal vocabulary notebook, not as a research-grade scheduling engine.
