import type { DishId } from './swaad'

type Line = { hi: string; en: string }

/**
 * Each dish in words: its name, the one line the stall's vendor says as they hand it over, what it is, and
 * where in Jaipur people love it (an area, never a shop; no prices).
 */
export const DISH_TEXT: Record<DishId, { name: Line; vendor: Line; what: Line; where: Line }> = {
  chai: {
    name: { hi: 'Kulhad wali chai', en: 'Kulhad chai' },
    vendor: {
      hi: 'Lijiye, garma-garam — kulhad ki mitti ki khushboo ke saath.',
      en: 'Here you go, piping hot, with the scent of the clay cup.',
    },
    what: {
      hi: 'Adrak-elaichi wali doodh ki chai, mitti ke kulhad mein.',
      en: 'Milky tea with ginger and cardamom, poured into a clay cup.',
    },
    where: {
      hi: 'Chaupar se lekar har nukkad ki tapri tak, Jaipur ka din isi se shuru hota hai.',
      en: "From the Chaupar to every corner stall, this is how Jaipur's day begins.",
    },
  },
  kachori: {
    name: { hi: 'Pyaaz kachori', en: 'Pyaaz kachori' },
    vendor: {
      hi: 'Abhi kadhai se nikli hai — sambhal ke, garam hai!',
      en: 'Straight out of the kadhai — careful, it is hot!',
    },
    what: {
      hi: 'Khasta kachori, andar masaledaar pyaaz; saath mein khatti-meethi chutney.',
      en: 'A crisp, flaky kachori filled with spiced onion, with a sweet-and-sour chutney.',
    },
    where: {
      hi: 'Purane shahar ke bazaaron mein subah ka nashta yahi hai.',
      en: "In the old city's bazaars, this is breakfast.",
    },
  },
  lassi: {
    name: { hi: 'Lassi', en: 'Lassi' },
    vendor: {
      hi: 'Malai upar se, kulhad bhar ke — aaram se pijiye.',
      en: 'Cream on top, the cup filled to the brim — take your time.',
    },
    what: {
      hi: 'Gaadhi meethi dahi ki lassi, upar malai ki parat, mitti ke kulhad mein.',
      en: 'Thick, sweet curd lassi under a layer of cream, in a clay cup.',
    },
    where: {
      hi: 'MI Road ki taraf log subah-subah iske liye line lagaate hain.',
      en: 'Around MI Road, people queue for it first thing in the morning.',
    },
  },
  kulfi: {
    name: { hi: 'Kulfi', en: 'Kulfi' },
    vendor: {
      hi: 'Matke se seedhi nikli hai — pighalne se pehle kha lijiye.',
      en: 'Fresh out of the matka — have it before it melts.',
    },
    what: {
      hi: 'Der tak kadhaye doodh ki jami hui kulfi, kesar aur pista ke saath.',
      en: 'Slow-simmered milk, frozen dense, with saffron and pistachio.',
    },
    where: {
      hi: 'Purane shahar ke bazaaron mein garmi ki shaam iske bina poori nahi hoti.',
      en: "A summer evening in the old city's bazaars is not complete without one.",
    },
  },
  ghewar: {
    name: { hi: 'Ghewar', en: 'Ghewar' },
    vendor: {
      hi: 'Teej aur Sankranti ke mausam mein to iski baat hi alag hai — chakh ke dekhiye.',
      en: 'Around Teej and Sankranti it is at its best — have a taste.',
    },
    what: {
      hi: 'Jaalidaar, ghee mein tala aur chashni mein dooba; upar rabdi ya malai.',
      en: 'A lacy disc fried in ghee and soaked in syrup, topped with rabdi or cream.',
    },
    where: {
      hi: 'Saawan aur Teej mein Johari Bazaar ki galiyan iski khushboo se bhar jaati hain.',
      en: 'Through Saawan and Teej, the lanes of Johari Bazaar smell of it.',
    },
  },
  'mirchi-vada': {
    name: { hi: 'Mirchi vada', en: 'Mirchi vada' },
    vendor: {
      hi: 'Teekha hai, par dil se banaya hai — saath mein chai le lijiyega.',
      en: 'It is fiery, but made with heart — have a chai with it.',
    },
    what: {
      hi: 'Moti hari mirch mein aloo ka masala, besan mein lapet ke tali hui.',
      en: 'A fat green chilli stuffed with spiced potato, dipped in gram batter and fried.',
    },
    where: {
      hi: 'Jodhpur ki den hai, par Jaipur ke college aur coaching ke nukkadon ki jaan.',
      en: "Jodhpur's gift, and the life of Jaipur's college and coaching corners.",
    },
  },
  'dal-baati': {
    name: { hi: 'Dal baati churma', en: 'Dal baati churma' },
    vendor: {
      hi: 'Baati abhi angaaron se utri hai — ghee hum apne haath se daalenge.',
      en: 'The baati is just off the embers — we pour the ghee ourselves.',
    },
    what: {
      hi: 'Angaaron pe sinki baati, panchmel dal aur meetha churma; upar se ghee.',
      en: 'Ember-baked wheat baati, five-lentil dal and sweet churma, with ghee over it all.',
    },
    where: {
      hi: 'Pahaadi ke dhabon se ghar ki har daawat tak, Rajasthan ki thaali ki shaan.',
      en: "From the hill dhabas to every family feast, the pride of Rajasthan's thali.",
    },
  },
  golgappe: {
    name: { hi: 'Golgappe', en: 'Golgappe' },
    vendor: {
      hi: 'Paani teekha ya meetha? Dona aage kijiye, ek-ek karke.',
      en: 'Spicy water or sweet? Hold out your leaf bowl, one at a time.',
    },
    what: {
      hi: 'Karaari gol puri, andar aloo-chana, aur imli-pudine ka paani.',
      en: 'A crisp hollow puri with potato and chickpea, filled with tamarind-mint water.',
    },
    where: {
      hi: 'Shaam hote hi Jaipur ke har bazaar ke thele par isi ki bheed lagti hai.',
      en: "Come evening, this is what the crowd at every Jaipur bazaar's cart is for.",
    },
  },
}
