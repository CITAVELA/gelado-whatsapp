import { Module } from '@nestjs/common';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

/** S5 · Biblioteca de archivos (carpetas, búsqueda, subir/borrar solo admin). */
@Module({ controllers: [LibraryController], providers: [LibraryService], exports: [LibraryService] })
export class LibraryModule {}
