import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductService } from '../../../core/services/product.service';
import { Category } from '../../../core/models/category.model';

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
export class HomeComponent implements OnInit {
  private productService = inject(ProductService);
  private carouselRef = viewChild<ElementRef<HTMLDivElement>>('carousel');

  protected readonly heroImage =
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAlN6hnWaua6v0ZpVv0X01Lr_4tTqsOkjJ8Mz9zDq9aivs7sxUR4KfoK8Ru8fIAlj8AXYx_Ww1wN36aMZ-I0wcMYokgR9HphXOd0LwJyqIEkmQVETjwWsWzW86gXc8Hn2sVQyqyytEnrpdoDJnD0l0Q_Sn60IMp6HmigZq0mzRpCBKo1ssh35pURoogLo9NtfRH31sWuM88xKdsWRxhlZq6HOZodpmTVYHZOofEw9OYCnfn5asrycZTDKlcLEkelb0VAuvQPxnd3FH_';

  /**
   * Colecciones de la portada. Vienen del backend para que la home refleje las
   * categorías que el admin tiene activas en vez de una lista fija.
   */
  protected readonly categories = signal<Category[]>([]);
  protected readonly categoriesLoading = signal(true);

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

  ngOnInit(): void {
    this.productService.getCategories().subscribe({
      next: (cats) => {
        this.categories.set(
          cats
            .filter((c) => c.is_active)
            .sort((a, b) => a.order_display - b.order_display),
        );
        this.categoriesLoading.set(false);
      },
      error: () => this.categoriesLoading.set(false),
    });
  }

  scrollLeft(): void {
    this.carouselRef()?.nativeElement.scrollBy({ left: -420, behavior: 'smooth' });
  }

  scrollRight(): void {
    this.carouselRef()?.nativeElement.scrollBy({ left: 420, behavior: 'smooth' });
  }
}
