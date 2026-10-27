import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { IStorageSettings } from './storage-settings.service';
import { StorageSettingsComponent } from './storage-settings.component';
import { TODAY, cloud, minio } from './storage-fixtures';
import { BIN_18 } from '../recycle-bin/recycle-bin-fixtures';
import { IRecycleBinItem } from '../recycle-bin/recycle-bin.service';

// ACC-260, PR D — the usage card's "Includes 212 MB in the recycle bin", summed
// from the bin list (plan G6), with "Open recycle bin". Shown only when the bin
// has files and the viewer may open it, and only beside AccreditMe cloud's meter.

const STORAGE_URL = `${environment.apiUrl}/tenant/storage`;
const LIMITS_URL = `${environment.apiUrl}/files/upload-limits`;
const BIN_URL = `${environment.apiUrl}/tenant/recycle-bin`;

describe('StorageSettingsComponent — the recycle bin line (ACC-260, PR D)', () => {
  let fixture: ComponentFixture<StorageSettingsComponent>;
  let http: HttpTestingController;

  function render(settings: IStorageSettings, bin: IRecycleBinItem[] | 'fail' | null, canOpen = true): HTMLElement {
    TestBed.configureTestingModule({
      imports: [StorageSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => canOpen && p === 'tenant:manage_config' } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StorageSettingsComponent);
    fixture.componentInstance.today.set(TODAY);
    fixture.detectChanges();
    http.expectOne(LIMITS_URL).flush({ maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf'] });
    if (bin === 'fail') http.expectOne(BIN_URL).flush(null, { status: 500, statusText: 'x' });
    else if (bin) http.expectOne(BIN_URL).flush(bin);
    http.expectOne(STORAGE_URL).flush(settings);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  const line = (el: HTMLElement) => el.querySelector('[data-testid="usage-bin"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  it('AccreditMe cloud with files in the bin: their total, and a link to the bin', () => {
    const el = render(cloud(), BIN_18);
    const total = BIN_18.reduce((s, i) => s + i.sizeBytes, 0);
    expect(total).withContext('non-vacuity: the bin has bytes').toBeGreaterThan(0);
    expect(line(el)).toMatch(/^Includes \d+(\.\d)? MB in the recycle bin · Open recycle bin$/);
    expect(el.querySelector('[data-testid="usage-open-bin"]')!.getAttribute('href')).toBe('/admin-settings/recycle-bin');
  });

  it('an empty bin, a bin that could not be read, or a viewer who may not open it: no line', () => {
    expect(line(render(cloud(), []))).toBeNull();
    TestBed.resetTestingModule();
    expect(line(render(cloud(), 'fail'))).toBeNull();
    TestBed.resetTestingModule();
    // Without the permission the bin is never asked for.
    expect(line(render(cloud(), null, false))).toBeNull();
  });

  it("the organisation's own storage: no line, since only AccreditMe cloud is metered", () => {
    expect(line(render(minio(), BIN_18))).toBeNull();
  });
});
