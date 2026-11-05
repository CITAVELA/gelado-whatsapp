import { Global, Module } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

/** S2 · Contactos: listado, ficha, importación, exportación, consentimiento y bajas. */
@Global()
@Module({
  controllers: [ImportController, ContactsController],
  providers: [ConsentService, ContactsService, ImportService],
  exports: [ConsentService, ContactsService],
})
export class ContactsModule {}
