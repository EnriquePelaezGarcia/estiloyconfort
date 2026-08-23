import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ContactRequest, ContactResponse } from '../models/contact.model';

/** Formulario público de la página /contacto. */
@Injectable({ providedIn: 'root' })
export class ContactService {
  private api = inject(ApiService);

  send(payload: ContactRequest): Observable<ContactResponse> {
    return this.api.post<ContactResponse>('/contact', payload);
  }
}
