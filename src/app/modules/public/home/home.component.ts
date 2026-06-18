import { ChangeDetectionStrategy, Component, ElementRef, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Category {
  label: string;
  image: string;
}

interface Product {
  name: string;
  price: string;
  badge: string | null;
  image: string;
}

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  imports: [RouterLink],
})
export class HomeComponent {
  private carouselRef = viewChild<ElementRef<HTMLDivElement>>('carousel');

  protected readonly heroImage =
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAlN6hnWaua6v0ZpVv0X01Lr_4tTqsOkjJ8Mz9zDq9aivs7sxUR4KfoK8Ru8fIAlj8AXYx_Ww1wN36aMZ-I0wcMYokgR9HphXOd0LwJyqIEkmQVETjwWsWzW86gXc8Hn2sVQyqyytEnrpdoDJnD0l0Q_Sn60IMp6HmigZq0mzRpCBKo1ssh35pURoogLo9NtfRH31sWuM88xKdsWRxhlZq6HOZodpmTVYHZOofEw9OYCnfn5asrycZTDKlcLEkelb0VAuvQPxnd3FH_';

  protected readonly categories: Category[] = [
    {
      label: 'Salas',
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuAuZQ06kLaJoT7ChrSVogQjh2c7s__xZX1oxo5SSBlwj9sE-e5I92vtBl8lNXjLzLeaMHmczZ9-4wh2lVBU0nbH0U1KwyWcMO8BFRs5654rIrnnYfr8cxjyAJV8zNUdR8zpYYOETofG7AWLnYs8yWmAKG4HNyKq2B68rEl85EskV8U8Jov4EU6ySthH2k142wpKaeChatf1VpvGdvtim61iyRtyNTG4d9oSq2qKMEzRCyK-h3vXB--Ph7njVctLeuoNWgWjqm-dx-zO',
    },
    {
      label: 'Recámaras',
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuC-aHkYuWecw53OVlNl_ru3-nMz4ar9fcs73P20odomxUKexplHQ1iFZ5fTQpTp7J9d1gCn7yyF_gP1gCxS7xUyX3OY2ssarcHz3CUCRTguhEE_2JrGjNmizy1ZTEFNeOYsA8n5Ay18BFexqRPSrFDSosMlU_P6AYQnlWwS4iYqdccve74EzXvpjmCBp6-0at-L538D1mb-BrewkhzjTZFYGYpyomQifREywsqycEJ_-5jmDdFEVmy4devmnJvchfD2j8DmyyFPjbsF',
    },
    {
      label: 'Comedores',
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuD8Qkl6aMu1DsGWtjzGX5lmN-AnRpfoYh6hnSOUyr3Li5OALbzCH4UM-OPoL4GnY41KbgELCefPK82Vh_DZJ5_axMDgMlBwvvJ_dqSANeeMPASDxT6ZUKM9hxX1kCynmqis_G2yab04YGX5WRvLzBQx1iavfrPhGjGXkIt3F4huC4jQgzW481ds01aQHsilZ6kVGFSPAvn78js3zX8oNqhHGlPMoTk5i0hF_lXS3tsTVtUL1WCcnXF-XvLka6-Fjrf_WG0bE_wIjzHO',
    },
    {
      label: 'Oficina',
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuCZ4mVCCBi9_bY1nVFPhTEWzjSwEKebG_pPwGGm2UPkFM6lMNfSVD5lumGjWtApB45MxgBRCYmF-9UMKh0ccAsk1F7g9yylGaGkBBUtZWaBlNfOtlJdw_iu64uz7ffBZP5wtB31PNTz9_jhJimlYFasN6fMTilDnNwO0ztrL2fZiNWduL6aFtx8H3ln2TMiuURWZ-8ew3RvYE5rHvb4B_GibuOCO6boYB34nThO2DLO6c84VHmJWdXXgr72stEftdLlhuKgnKNQSrzr',
    },
    {
      label: 'Acentos',
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuAXABtuQxlWRbfyurwZXXTdKL4pEEmLkuzN67N3fBl6gnM3UZPLZ1OOlvWaN3evzWF-5n8hFl9hoIbK-ZS70nKm4zIMLVJvEZBn4u2qL90PQodPgDd0RLczHRVVXl-J9C_MVHqCGQk1MhNnrohvlnWvxIAYLUB_cephLuMPsQX1wmJxqwu0rLiGtvTHXb-AlPIhyqwDrHeGuM2wIzr5USCiZ1CzmixLgH_9PPw6IjDumqLPog-4H1Di5DlszkZuWlA3meOKSyEQXFTM',
    },
  ];

  protected readonly products: Product[] = [
    {
      name: 'Sillón Nórdico Anthracite',
      price: '$12,499 MXN',
      badge: 'Nuevo',
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuDc2X91EO1102i6U-PO3HUdOIe0ur143Bczim-A8YMoGVdTsXRtiJND3BYhO3ncXqKFWA5U0Z1jSZ6F_KXjXmYljmIL5kdntA5Q3019O1gR7ihg3SDXdWvPPvZ5MkDFs19KFgenQOMU6t1oYsuXhfXi91eqpYceAINWXxKjXN21vPRuCRIF7BZQvN1QJxwa0NaimqUO-uODB1xeGJIuo7PNTb0NlLpChSq31YIgYSU8Uj0c_t1W3ExBGhZtd3Sa8cs1HArPlFXCiFSG',
    },
    {
      name: 'Mesa de Comedor Roble',
      price: '$18,900 MXN',
      badge: null,
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuBvoqtfR8b70DUAHuHx9okdp513KLUy8WtwOPkcG1-8r_BEb4AWty3O3JH5nk9AesBBr1ugV-u-x2-TvveljBwUNrxfh2MhhB1KKi0p7htzEdQ-ZLKObW9uW09wrFfv0tFZFAS4EdbIM-Odaw2B_JKGE9akdJDQUNzzNO5TsbrAFfx3fKL5BBW4mo9QdiidvROpWtLi4Nf8lcSPUCVFCHurvP_PRS6FvFfG3DKilnC_qBBQyLDMW9STGfIM7qFbsWzZzgp4hUpfW0n7',
    },
    {
      name: 'Lámpara de Pie Orb',
      price: '$4,200 MXN',
      badge: 'Sustentable',
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuB8cYzB0CpfPxK5oHGDOhY9d4o7ZAJzVN_G--0mro5szEwDteH3CuI3VhbfbsBW0QD41aoLtRpIukDwiJGLf3Id9aM1j7j1gqQBixBz3yg_wAfJl6hmmINXGNqlVDmuduOpiCGdAbEzaSuJF6xcKK_BfJh5dTnWGuzRF22KTbSw167uqqjwMALiNG_j6xaNuMvBahPWHsdXyV_Cb6MbCRunXXyzP-OWxs0OYFZxnfNHsw7HKU9lrZ9nc3CaQ3gDRNnaSWAAtGtAIEy5',
    },
    {
      name: 'Sofá Modular Linen',
      price: '$35,000 MXN',
      badge: null,
      image:
        'https://lh3.googleusercontent.com/aida-public/AB6AXuBqIHfZK1JhBYwDAk4822iZn54pFAnjFBHMTU0d7OoXyjNoqsb1avLg2I0gY25gcN6r7Yc-f7PxQLPT9oVxt_OBa2UlI71OInL5qrIwTzk13R4VBw2Ou4JicwlK_w3TxGm3tvrutMLb06yaFHtvlizCkujNSZC_2exgXMmJAFQ3f533jfd5lzPUJNOkFIwrRr9PUHqKA4FKD1Bo9ZwPxEO60bmO_yZ0EZRE29oXdIOEg2HIiYSVv3zOjo4RB6mfEM--ULpaC9PGqz19',
    },
  ];

  scrollLeft(): void {
    this.carouselRef()?.nativeElement.scrollBy({ left: -420, behavior: 'smooth' });
  }

  scrollRight(): void {
    this.carouselRef()?.nativeElement.scrollBy({ left: 420, behavior: 'smooth' });
  }
}
