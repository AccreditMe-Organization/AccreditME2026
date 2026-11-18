import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreatePublicHolidayDto } from './create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './update-public-holiday.dto';
import { holidayDateAt } from './holiday-date';

// ACC-318 — a holiday's date is a calendar date only (YYYY-MM-DD), the shape
// the screen sends (toApiDate() in public-holiday-list.component.ts). A time or
// an offset would store another day's instant, so the pipe refuses it with its
// ordinary 400 before the service runs. Tested through a pipe configured
// exactly as main.ts configures the app's.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

async function outcome(metatype: typeof CreatePublicHolidayDto | typeof UpdatePublicHolidayDto, date: string): Promise<'accepted' | string[]> {
  const body = metatype === CreatePublicHolidayDto ? { nameEn: 'Christmas', date } : { date };
  try {
    await pipe.transform(body, { type: 'body', metatype });
    return 'accepted';
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { message: string[] }).message;
  }
}

describe('A holiday date is a calendar date only (ACC-318)', () => {
  describe.each([
    ['Create', CreatePublicHolidayDto],
    ['Update', UpdatePublicHolidayDto],
  ] as const)('%s', (_name, metatype) => {
    it.each(['2026-12-25', '2024-02-29'])('accepts %p', async (date) => {
      expect(await outcome(metatype, date)).toBe('accepted');
    });

    it.each([
      '2026-12-25T00:00:00+03:00',
      '2026-12-25T00:00:00Z',
      '2026-12-25T10:00:00',
      '25/12/2026',
      '2026-12-25 ',
      '20261225',
    ])('refuses %p, naming the shape', async (date) => {
      expect(await outcome(metatype, date)).toContain('date must be a calendar date, YYYY-MM-DD');
    });

    it.each(['2026-02-30', '2026-13-01', '2025-02-29'])('refuses %p, which is not a real date', async (date) => {
      expect(await outcome(metatype, date)).not.toBe('accepted');
    });
  });

  it('a holiday is stored as its date at midnight UTC', () => {
    expect(holidayDateAt('2026-12-25').toISOString()).toBe('2026-12-25T00:00:00.000Z');
  });
});
