import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { SocketIoModule, SocketIoConfig } from 'ngx-socket-io';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';

const socketConfig: SocketIoConfig = { url: environment.wsUrl || '', options: { autoConnect: false } };

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient(withInterceptors([authInterceptor])),
    importProvidersFrom(SocketIoModule.forRoot(socketConfig)),
  ],
};
