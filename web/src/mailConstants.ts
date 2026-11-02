/** Shared by every place that polls or displays unread mail, so the home-page pollers
 * (GmailWidget, StatBar) warm the exact same server-side cache entry the full Mail page reads —
 * mismatched limits would mean each uses a different cache key and the page always pays for a
 * fresh IMAP fetch on click instead of hitting what's already warm. */
export const MAIL_LIMIT = 200;
