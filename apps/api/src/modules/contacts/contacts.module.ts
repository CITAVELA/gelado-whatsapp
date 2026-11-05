import { Global, Module } from '@nestjs/common';
import { ContactFactory } from './contact-factory.service';
import { ConsentService } from './consent.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { SuppressionService } from './suppression.service';

/** S2 · Contactos: listado, ficha, importación, exportación, consentimiento y bajas. */
@Global()
@Module({
  controllers: [ImportController, ContactsController],
  providers: [ConsentService, SuppressionService, ContactFactory, ContactsService, ImportService],
  exports: [ConsentService, SuppressionService, ContactFactory, ContactsService],
})
export class ContactsModule {}
