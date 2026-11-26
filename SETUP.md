# movie night — kaip paleisti (≈15 min)

Svetainė jau veikia **demo režimu**: atsidarius be nustatymų viskas saugoma tik tavo naršyklėje.
Kad draugai matytų tuos pačius filmus ir balsus, reikia dviejų dalykų: **Supabase** (duomenų bazės)
ir **hostingo** (vietos, kur gyvens svetainė). Abu nemokami.

---

## 1. Supabase (duomenų bazė) — ~5 min

1. Eik į https://supabase.com → **Start your project** → prisijunk (patogiausia per GitHub).
2. **New project**. Pavadink kaip nori (pvz. `movie-night`), sugalvok DB slaptažodį (jo nereikės),
   regionas: **Central EU (Frankfurt)**. Palauk ~1 min, kol projektas susikurs.
3. Kairėje **SQL Editor** → **New query** → įklijuok visą failą `supabase/schema.sql` → **Run**.
   Turi parašyti „Success. No rows returned“.
4. Kairėje **Project Settings** (krumpliaratis) → **API Keys** (arba **Data API**):
   - nusikopijuok **Project URL** (`https://xxxx.supabase.co`)
   - ir **publishable** raktą (`sb_publishable_…`). Jei matai tik seną variantą, tinka ir **anon public** raktas.
   ⚠️ **Niekada** nenaudok `service_role` / `secret` rakto: jis turi pilną prieigą.
5. Atidaryk `config.js` ir įrašyk:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'sb_publishable_…',
   ```

> Publishable / anon raktas *gali* būti matomas naršyklėje, taip ir turi būti.
> Visus įrašus saugo duomenų bazės taisyklės: niekas negali tiesiogiai keisti lentelių,
> tik per funkcijas su limitais (3 filmai, 5 bilietai), o host veiksmams reikia host rakto.

## 2. Hostingas — ~3 min (Netlify, be jokio kodo)

1. Eik į https://app.netlify.com/drop ir susikurk nemokamą paskyrą.
2. **Nutempk visą `movienight` aplanką** (tą, kuriame yra `index.html`) į puslapį.
3. Gausi nuorodą, pvz. `https://random-name-123.netlify.app`.
   **Site configuration → Change site name** → pvz. `upperroom-movies` →
   nuoroda bus `https://upperroom-movies.netlify.app`.
4. Kai vėliau ką nors pakeisi (pvz. `config.js`): **Deploys** → nutempk aplanką dar kartą.

*(Alternatyva: GitHub Pages arba Vercel, veikia bet kuris statinis hostingas, nes build'o nereikia.)*

## 3. Tapk host'u — 1 min

1. Atsidaryk `https://tavo-nuoroda/#/host`.
2. Sugalvok **host raktą** (6+ simboliai) → **set key & enter**.
   **Pirmas nustatęs raktą tampa host'u**, todėl padaryk tai prieš siųsdamas nuorodą draugams.
3. Pakeisk pavadinimą, šūkį, temą (spalvas). Viskas išsisaugo iškart.

## 4. Pakviesk

Įmesk nuorodą į group chatą (žinutės tekstą rasi žemiau). Draugams nereikia jokių paskyrų:
užtenka nickname'o, ir naršyklė juos „atsimena“.

---

## Kaip tai veikia (trumpai)

| Vieta | Kas ten |
|---|---|
| `/#/` | kambarys su TV → „wanna watch a movie?“ |
| `/#/board` | filmų pool'as, bilietai (balsai), datų rinkimas, svečių knyga |
| `/#/archive` | visi praėję vakarai ir laimėję filmai |
| `/#/host` | tavo pultas: pavadinimas, tema, data, balsavimo uždarymas, „feature“ filmas, kito vakaro atidarymas |

**Naujas vakaras:** host pulte **archive & start the next night**. Vakaras su laimėtoju keliauja į
archyvą (jei laimėtojo nepasirinkai, jis bus tas, kuris turi daugiausiai bilietų), o nuoroda lieka ta pati
ir atsidaro tuščias „night no. 2“.

**Filmų paieška** veikia be jokių raktų (iTunes + Wikidata). Jei nori gražesnių posterių ir tikslesnės
paieškos: nemokamas raktas https://www.themoviedb.org/settings/api → įrašyk `TMDB_API_KEY` į `config.js`.

**Klubo pavadinimas** ant lentelės virš TV: `CLUB_NAME` faile `config.js`.

## Jei kas nors negerai

- **„could not connect to the board“** → patikrink URL ir raktą `config.js` (be tarpų, su kabutėmis).
- **Pamiršai host raktą** → Supabase → SQL Editor → `delete from host_settings;` → nustatyk naują per `/#/host`.
- **Kažkas pridėjo nesąmonę** → host pulte prie filmo spausk **remove** (du kartus).
- **Nori viską pradėti iš naujo** → SQL Editor:
  `truncate events, participants, movies, votes, date_options, date_votes cascade;`
  ir paleisk paskutinį `insert into events …` bloką iš `schema.sql` dar kartą.
- **Nemokamas Supabase projektas užmiega po 7 dienų be veiklos** → supabase.com spausk **Restore**
  (duomenys nedingsta). Prieš kiekvieną vakarą tiesiog atsidaryk svetainę.

## Jei nori, kad tai padarytų Claude Code

Atsidaryk Claude Code šiame aplanke ir parašyk, pvz.:
> „Perskaityk SETUP.md. Sukurk GitHub repo `movie-night`, įkelk šį aplanką ir įjunk GitHub Pages.“

Supabase dalį (1 skyrius) vis tiek reikės paspausti pačiam, nes tam reikia tavo paskyros.
