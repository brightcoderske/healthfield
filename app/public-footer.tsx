import Image from "next/image";

export type PublicContact = { phone:string; whatsapp:string; supportEmail:string; address:string; openingHours:string; deliveryMessage:string; facebookUrl:string; instagramUrl:string; xUrl:string; tiktokUrl:string; licenceNumber:string };

export function PublicFooter({ contact, signedIn=false }: { contact:PublicContact; signedIn?:boolean }) {
  return <footer className="store-footer">
    <div className="footer-about">
      {contact.licenceNumber && <strong className="footer-licence-number"><span>Pharmacy Licence</span><b>{contact.licenceNumber}</b></strong>}
      <Image src="/healthfield-logo-clean.png" alt="Healthfield Pharmacy" width={190} height={68}/>
      <p>Your trusted pharmacy for medicines, skincare, wellness and personal-care essentials.</p>
      <div className="social-links">{contact.facebookUrl&&<a href={contact.facebookUrl} target="_blank" rel="noreferrer">f</a>}{contact.instagramUrl&&<a href={contact.instagramUrl} target="_blank" rel="noreferrer">IG</a>}{contact.xUrl&&<a href={contact.xUrl} target="_blank" rel="noreferrer">X</a>}{contact.tiktokUrl&&<a href={contact.tiktokUrl} target="_blank" rel="noreferrer">TT</a>}</div>
    </div>
    <nav><strong>Shop &amp; services</strong><a href="/#products">Shop products</a><a href="/prescriptions/upload">Upload prescription</a><a href="/conditions">Shop by condition</a><a href={signedIn?"/chat":"/login?next=/chat"}>Chat with us</a><a href="/account#orders">Track an order</a></nav>
    <nav><strong>Help &amp; information</strong><a href="/blog">Blogs &amp; health guide</a><a href="/about">About Healthfield</a><a href="/faq">Frequently asked questions</a><a href="/contact">Contact us</a><a href="/pharmacy/juja">Pharmacy service areas</a><a href="/shipping-policy">Shipping &amp; delivery</a><a href="/returns-policy">Returns &amp; refunds</a></nav>
    <nav><strong>Legal</strong><a href="/terms">Terms &amp; conditions</a><a href="/privacy-policy">Privacy policy</a><span>Secure checkout</span><span>Genuine products</span></nav>
    <div className="footer-contact"><strong>Contact</strong>{contact.phone&&<a href={`tel:${contact.phone.replace(/\s/g,"")}`}>{contact.phone}</a>}{contact.whatsapp&&<a href={`https://wa.me/${contact.whatsapp.replace(/\D/g,"")}`}>WhatsApp {contact.whatsapp}</a>}{contact.supportEmail&&<a href={`mailto:${contact.supportEmail}`}>{contact.supportEmail}</a>}{contact.address&&<span>{contact.address}</span>}{contact.openingHours&&<span>{contact.openingHours}</span>}<small>{contact.deliveryMessage}</small></div>
    <div className="footer-bottom"><span>© {new Date().getFullYear()} Healthfield Pharmacy. All rights reserved.</span><span>Product information does not replace professional medical advice.</span></div>
  </footer>;
}
