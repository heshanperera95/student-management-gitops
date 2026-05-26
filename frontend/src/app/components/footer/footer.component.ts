import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VersionService } from '../../services/version.service';
import { FRONTEND_VERSION } from '../../version';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.css']
})
export class FooterComponent implements OnInit {
  frontendVersion = FRONTEND_VERSION;
  backendVersion = '...';
  backendError = false;

  constructor(private versionService: VersionService) {}

  ngOnInit(): void {
    this.versionService.getBackendVersion().subscribe({
      next: (res) => (this.backendVersion = res.version),
      error: () => {
        this.backendVersion = 'unavailable';
        this.backendError = true;
      }
    });
  }
}
