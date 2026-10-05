// A deterministic "quote of the day" for the universal staff Home page. No
// table, no owner curation UI -- the owner asked for something to see on
// Home, not a CMS. Picked by day-of-year so it's identical for everyone and
// changes once at midnight IST, not on every page load.
const QUOTES = [
  'Small daily improvements lead to stunning results over time.',
  'Quality is not an act, it is a habit.',
  'Take care of your customers and they will take care of your business.',
  'Every great business was built one good day at a time.',
  'Discipline is choosing between what you want now and what you want most.',
  'The way to get started is to quit talking and begin doing.',
  'A customer well-served is worth ten referrals.',
  'Consistency is what transforms average into excellence.',
  'Teamwork divides the task and multiplies the success.',
  'Honesty and hard work build a reputation money cannot buy.',
  'Great things in business are never done by one person alone.',
  'Punctuality is the soul of good service.',
  'Success is the sum of small efforts repeated daily.',
  'Treat every customer the way you would want to be treated.',
  'A good attitude is the first step to a good day.',
] as const

function istDayOfYear(): number {
  const now = new Date()
  const istMs = now.getTime() + (now.getTimezoneOffset() + 330) * 60_000
  const ist = new Date(istMs)
  const start = new Date(ist.getFullYear(), 0, 1)
  return Math.floor((ist.getTime() - start.getTime()) / 86_400_000)
}

export function getDailyQuote(): string {
  return QUOTES[istDayOfYear() % QUOTES.length]
}
