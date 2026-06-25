# Remote Servers Guide

Add remote storage servers in **Settings → Remote Servers** (or via the volume list in the folder browser) by pasting a YAML definition. The schema is abstract and server-agnostic — new server types reuse the same shape.

## YAML Schema

```yaml
type: rclone          # Required. Registry key: "rclone" | "webdav"
displayName: My NAS   # Required. Label shown in the UI.
rcloneRemoteType: sftp  # rclone only. Drives the icon. Any rclone backend name.
crypt:                # Optional (rclone only). Wrap with rclone-crypt decryption.
  password: "..."     # Obscured rclone crypt password (rclone obscure <password>)
  password2: "..."    # Optional: obscured filename encryption salt
  path: /encrypted    # Optional: subfolder on the base remote where encrypted files live
                      # Use this instead of a full "remote:" if you just need a subpath.
connection:           # Required. Provider-specific key/value map.
  remoteName: MyRemote  # Required for rclone: the config entry name (must be unique)
  key: value
```

The `connection` map is opaque to the core — each provider validates and uses its own keys.

---

## Examples

### SMB / Samba (Windows shares, NAS, Time Capsule)

```yaml
type: rclone
displayName: NAS Share
rcloneRemoteType: smb
connection:
  host: nas.local
  user: media
  pass: yourpassword   # rclone obscure format; plain text also accepted
  port: "445"
  domain: WORKGROUP    # optional; omit for home NAS / macOS shares
```

> **Requires rclone ≥ 1.61.** No FUSE mount, no extra system packages — rclone's SMB client is pure Go.

### sftp (NAS / Linux server)

```yaml
type: rclone
displayName: My NAS
rcloneRemoteType: sftp
connection:
  host: nas.local
  user: media
  pass: mypassword
  port: "22"
```

### S3-compatible (AWS, Backblaze B2, Wasabi, MinIO…)

```yaml
type: rclone
displayName: Backblaze B2
rcloneRemoteType: b2
connection:
  account: your-account-id
  key: your-application-key
```

```yaml
type: rclone
displayName: AWS S3
rcloneRemoteType: s3
connection:
  region: us-east-1
  access_key_id: AKIAIOSFODNN7EXAMPLE
  secret_access_key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

### Dropbox / Google Drive / OneDrive

These require an OAuth token. Run `rclone config` interactively once to generate the token, then paste the resulting `[remote]` block's `token` value in `connection`:

```yaml
type: rclone
displayName: Dropbox
rcloneRemoteType: dropbox
connection:
  token: '{"access_token":"...","token_type":"bearer","expiry":"..."}'
```

### rclone-crypt wrapper (encrypted remote)

Point the source at the encrypted path; `crypt.password` is the obscured password from `rclone obscure <your-plaintext-password>`. The crypt backend transparently decrypts filenames and content before the app sees them.

```yaml
type: rclone
displayName: Encrypted NAS
rcloneRemoteType: sftp
crypt:
  path: /encrypted        # subfolder on the NAS where encrypted files live
  password: "obscuredPasswordHere"
  # password2: "obscuredSaltHere"  # optional, only if you set one in rclone crypt config
connection:
  remoteName: MyNAS
  host: nas.local
  user: media
  pass: mypassword
  port: "22"
```

If your encrypted folder is at the root of the remote (no subfolder), omit `path`. If you need to specify an arbitrary rclone remote path (e.g. across a different remote entirely), use `remote: OtherRemote:/path` instead of `path`.


### WebDAV (Nextcloud, ownCloud, generic)

```yaml
type: webdav
displayName: Nextcloud
connection:
  url: https://cloud.example.com/remote.php/webdav
  user: alice
  pass: app-password-from-nextcloud
```

---

## Importing from rclone.conf

If you already have a working rclone remote, find its block in `~/.config/rclone/rclone.conf`:

```ini
[mynas]
type = sftp
host = nas.local
user = media
pass = ObscuredPassword
port = 22
```

Translate to YAML:
- `type` line → `type: rclone` + `rcloneRemoteType: sftp`
- All other keys → go under `connection:`

```yaml
type: rclone
displayName: mynas
rcloneRemoteType: sftp
connection:
  host: nas.local
  user: media
  pass: ObscuredPassword
  port: "22"
```

---

## How it works

1. **Listing** — rclone sources use `rclone rcd --rc-serve` (one sidecar process); WebDAV sources use PROPFIND.
2. **Streaming** — the media-server fetches bytes directly from the rcd HTTP server or the WebDAV URL with range support. No FUSE mount needed.
3. **Cache** — the media-server's AES-256-CTR encrypted disk cache is used for prefetched items, identical to local files.
4. **Credentials** — connection details are AES-256-GCM encrypted at rest (keyed per user). The browser never sees raw credentials.

## Adding a new server type

1. Implement `RemoteProvider` in `backend/src/services/remote/<type>.provider.ts`
2. Add a fetcher in `media-server/src/services/remote/fetcher.ts`
3. Register both under the `type` key in their respective registries
4. Add an icon case in `FolderSelection.tsx → serverIcon()`
5. Widen the `chk_remote_servers_type` CHECK constraint in a new migration
