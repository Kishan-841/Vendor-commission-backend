import type { Response } from 'express';
import type { Readable } from 'node:stream';

// Send a file body (Buffer or stream) to the client with safe download headers.
// `nosniff` + a neutral default type keep user-uploaded content from ever being
// rendered by the browser.
export function sendDownload(
  res: Response,
  body: Buffer | Readable,
  opts: {
    fileName: string;
    contentType?: string;
    disposition?: 'attachment' | 'inline';
    contentLength?: number;
  },
) {
  const { fileName, contentType = 'application/octet-stream', disposition = 'attachment', contentLength } = opts;
  const safe = fileName.replace(/[^\w.\- ]/g, '_');
  res.setHeader('Content-Disposition', `${disposition}; filename="${safe}"`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (Buffer.isBuffer(body)) {
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
  } else {
    if (contentLength) res.setHeader('Content-Length', String(contentLength));
    body.pipe(res);
  }
}
