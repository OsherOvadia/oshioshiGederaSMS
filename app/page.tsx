import Logo from "./Logo";
import VIPForm from "./VIPForm";
import HeroSlideshow from "./HeroSlideshow";

export default function HomePage() {
  return (
    <>
      <HeroSlideshow />
      <div className="container">
        <div className="logo-area">
          <Logo />
        </div>
        <p className="eyebrow">מועדון ה-VIP · גדרה</p>
        <h2>מועדון ה-VIP שלנו</h2>
        <p>הירשמו לקבלת הטבות בלעדיות, מבצעי 1+1 ועדכונים חמים!</p>

        <VIPForm />
      </div>
    </>
  );
}
