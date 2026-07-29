Put your audio files in this folder (subfolders are fine — they are scanned recursively).

Supported formats: mp3, flac, m4a, aac, ogg, opus, wav, wma, aiff, alac.

For a large library (10,000+ songs), the fastest way to load them is:
  1. Copy the files into this folder using Windows File Explorer.
  2. Run:  npm run scan
     (or click "Rescan library" as an admin in the web app).

Album art and metadata (title / artist / album) are read automatically from
each file's tags. Files without tags fall back to their filename as the title.
