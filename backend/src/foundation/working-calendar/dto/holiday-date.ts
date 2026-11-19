// ACC-318 — a public holiday's date as the API accepts it: a calendar date,
// YYYY-MM-DD, with no time and no offset. Stored as that date at midnight UTC
// (holidayDateAt), and read back as a calendar day in every zone.
export const HOLIDAY_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The stored instant for a holiday's date: that date at midnight UTC. */
export function holidayDateAt(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
