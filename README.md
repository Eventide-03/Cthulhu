# Cthulhu

A Surfer-based Firefox ESR 140 fork.

## Notes

### Browser-data import — Windows caveat (Chrome App-Bound Encryption)

On **Windows**, importing Chrome **passwords and cookies** via the raw profile
migrator is unreliable: Chrome uses **App-Bound Encryption (ABE)**, which binds
the decryption key to the Chrome executable, so Firefox's migrator cannot
decrypt those items. The **Windows-safe method is the CSV export path** — export
passwords from Chrome and import the CSV via the Password Manager /
`about:logins` "Import from a File" flow. (Bookmarks and history import normally
on all platforms.)

_To be verified during the post-Phase-8 Windows shakedown._
