import type { FestivalId } from './protocol'

export interface FestivalEntry {
  id: FestivalId
  start: string // YYYY-MM-DD, IST, inclusive
  end: string // YYYY-MM-DD, IST, inclusive
}

// Sources: drikpanchang.com (New Delhi reference; Rajasthan observes the same civil day) cross-checked with
// dekhopanchang.com, hindu-blog.com 2027 calendar and publicholidays.in. Gazetted Rajasthan lists are not
// yet published for these years. Windows: sankranti = day before + day; holi = Holika Dahan..Dhulandi;
// gangaur and teej = festival day + following day (Jaipur processions); diwali = Dhanteras..Bhai Dooj.
//
// 2027
//  - Sankranti Jan 14: publicholidays.in + dekhopanchang.com (hindu-blog says rituals may run into Jan 15).
//  - JLF Jan 14-18: organiser announcement of the 20th edition (Time Out India, Outlook, Peter Bergen listing).
//  - Holi: Holika Dahan Mar 21, Dhulandi Mar 22: drikpanchang.com + dekhopanchang.com + hindu-blog.com.
//  - Gangaur Apr 9: drikpanchang.com + hindu-blog.com.
//  - Hariyali Teej Aug 4: dekhopanchang.com + hindu-blog.com (publicholidays.in lists a Haryana-only Sep 3,
//    which is Hartalika Teej; ignored).
//  - Diwali: Dhanteras Oct 27 .. Bhai Dooj Oct 31: drikpanchang.com + dekhopanchang.com.
// 2028
//  - Sankranti Jan 15: calendardate.com + publicholidays.in + drikpanchang.com Uttarayana page.
//  - Holi: Holika Dahan Mar 10, Dhulandi Mar 11: drikpanchang.com + dekhopanchang.com (Holika Dahan page).
//  - Gangaur Mar 29: drikpanchang.com (tritiya 28 Mar 13:02 to 29 Mar 13:58 IST).
//  - Hariyali Teej Jul 24: dekhopanchang.com + publicholidays.in.
//  - Diwali: Dhanteras Oct 15 .. Bhai Dooj Oct 19: drikpanchang.com + dekhopanchang.com.
export const CALENDAR: FestivalEntry[] = [
  { id: 'sankranti', start: '2027-01-13', end: '2027-01-14' },
  { id: 'jlf', start: '2027-01-14', end: '2027-01-18' },
  { id: 'holi', start: '2027-03-21', end: '2027-03-22' },
  { id: 'gangaur', start: '2027-04-09', end: '2027-04-10' },
  { id: 'teej', start: '2027-08-04', end: '2027-08-05' },
  { id: 'diwali', start: '2027-10-27', end: '2027-10-31' },

  { id: 'sankranti', start: '2028-01-14', end: '2028-01-15' },
  // UNVERIFIED: JLF 2028 dates are not announced; last week of January placeholder.
  { id: 'jlf', start: '2028-01-25', end: '2028-01-31' },
  { id: 'holi', start: '2028-03-10', end: '2028-03-11' },
  // UNVERIFIED: only drikpanchang.com states Gangaur Mar 29 2028; dekhopanchang.com only shows Tritiya that day.
  { id: 'gangaur', start: '2028-03-29', end: '2028-03-30' },
  { id: 'teej', start: '2028-07-24', end: '2028-07-25' },
  { id: 'diwali', start: '2028-10-15', end: '2028-10-19' },
]
