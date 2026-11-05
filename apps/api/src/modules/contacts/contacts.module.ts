import { Global, Module } from '@nestjs/common';
import { ConsentService } from './consent.service';

/** S2 · Contactos: listado, ficha, importación, exportación, consentimiento y bajas. */
@Global()
@Module({ providers: [ConsentService], exports: [ConsentService] })
export class ContactsModule {}
