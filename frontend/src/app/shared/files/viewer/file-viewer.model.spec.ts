import { downloadAllowed, previewKindFor } from './file-viewer.model';
import { pdfDocumentOptions } from './pdf-loader';

describe('previewKindFor (ACC-189)', () => {
  it('maps the server\'s types to a renderer', () => {
    expect(previewKindFor('application/pdf')).toBe('pdf');
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) expect(previewKindFor(t)).toBe('image');
    expect(previewKindFor('text/plain')).toBe('text');
    expect(previewKindFor('text/csv')).toBe('csv');
  });

  it('Office files, HEIC and anything unknown are download only (ACC-192)', () => {
    for (const t of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'image/heic',
      'image/svg+xml',
      'text/html',
      '',
    ]) {
      expect(previewKindFor(t)).toBe('none');
    }
  });
});

describe('downloadAllowed (ACC-189)', () => {
  it('Download is offered in every state except deleted and SharePoint access withdrawn', () => {
    expect(downloadAllowed(null)).toBeTrue();
    for (const p of ['noPreview', 'storageBlocked', 'failed'] as const) expect(downloadAllowed(p)).toBeTrue();
    expect(downloadAllowed('deleted')).toBeFalse();
    expect(downloadAllowed('withdrawn')).toBeFalse();
  });
});

describe('pdfDocumentOptions (ACC-189)', () => {
  it('pins how every PDF is opened: no XFA, no system fonts, our own assets', () => {
    const options = pdfDocumentOptions(new Uint8Array(1));
    expect(options.enableXfa).toBeFalse();
    expect(options.useSystemFonts).toBeFalse();
    expect(options.cMapPacked).toBeTrue();
    for (const url of [options.cMapUrl, options.standardFontDataUrl, options.wasmUrl, options.iccUrl]) {
      expect(new URL(url).origin).toBe(location.origin);
      expect(url).toContain('/assets/pdfjs/');
    }
  });
});
