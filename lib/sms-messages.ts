/**
 * All outbound SMS texts live here. Israeli Spam Law §30A(e)(2) requires every
 * promotional SMS to carry the advertiser's name; the opt-out footer is
 * appended automatically by /api/send_sms_task.
 */
export const BRAND = "Oshi Oshi Gedera";

export function welcomeSms(name: string): string {
  return `${BRAND}: היי ${name}, איזה כיף שהצטרפת אלינו! 🍣 מחכה לך מתנת הצטרפות במסעדה החל ממחר, ומעכשיו המבצעים, ההטבות וה-1+1 מגיעים ישירות אליך.`;
}

export function birthdaySms(name: string): string {
  return `${BRAND}: היי ${name}, חוגג/ת יום הולדת החודש? 🎂 מזל טוב! מחכה לך מתנת יום הולדת במסעדה. בואו לחגוג איתנו! 🍣`;
}

export function anniversarySms(name: string): string {
  return `${BRAND}: היי ${name}, חוגגים יום נישואין החודש? 💍 מזל טוב! מחכה לכם מתנת יום נישואין במסעדה. נשמח לחגוג איתכם! 🍣`;
}
