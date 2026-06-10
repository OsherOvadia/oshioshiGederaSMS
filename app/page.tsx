import Logo from "./Logo";
import VIPForm from "./VIPForm";
import HeroSlideshow from "./HeroSlideshow";

const BENEFITS = [
  {
    icon: "🥢",
    title: "מבצעים לחברים בלבד",
    text: "דילים ומבצעי 1+1 לפני כולם, ישירות ב-SMS",
  },
  {
    icon: "🎂",
    title: "פינוק יום הולדת",
    text: "מתנה שמחכה לכם כל שנה בחודש יום ההולדת",
  },
  {
    icon: "📱",
    title: "בלי אפליקציות ובלי כרטיסים",
    text: "הצטרפות של 30 שניות — הכל בהודעה אחת",
  },
];

export default function HomePage() {
  const unsubKeyword = (process.env.UNSUBSCRIBE_KEYWORD || "1111").trim();

  return (
    <>
      <HeroSlideshow />
      <main className="container">
        <div className="logo-area">
          <Logo />
        </div>
        <p className="eyebrow">מועדון ה-VIP · גדרה</p>
        <h1 className="headline">הטבות בלעדיות, ישר לנייד</h1>
        <p className="subline">
          הצטרפות של 30 שניות, פינוקים כל השנה — מבצעי 1+1, הטבת יום הולדת ועדכונים חמים ב-SMS.
        </p>
        <ul className="benefits">
          {BENEFITS.map((b) => (
            <li key={b.title} className="benefit">
              <span className="benefit-icon" aria-hidden="true">
                {b.icon}
              </span>
              <div>
                <span className="benefit-title">{b.title}</span>
                <p className="benefit-text">{b.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <VIPForm unsubKeyword={unsubKeyword} />
      </main>
    </>
  );
}
