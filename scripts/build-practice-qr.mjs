// The printable QR poster (public/practice-share.html) is now self-generating:
// it builds the QR code + URL at runtime from the page's own origin (via the
// /api/qr endpoint), so it is always correct on whatever domain it is served
// from — ngrok, localhost, or www.gaanasudhamusic.com — with no rebuild and no
// hardcoded URL. This script is therefore no longer needed and intentionally
// does nothing, so running it can't reintroduce a stale hardcoded address.
console.log('practice-share.html is self-generating (QR built at runtime from location.origin).');
console.log('Nothing to build. Edit public/practice-share.html directly if you need to change the poster.');
