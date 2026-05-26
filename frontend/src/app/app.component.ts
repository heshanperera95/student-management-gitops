import { Component } from '@angular/core';
import { StudentFormComponent } from './components/student-form/student-form.component';
import { StudentListComponent } from './components/student-list/student-list.component';
import { FooterComponent } from './components/footer/footer.component';
import { Student } from './models/student.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [StudentFormComponent, StudentListComponent, FooterComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  editingStudent: Student | null = null;

  // Reference to the list component so we can refresh it
  onStudentSaved(listComponent: StudentListComponent): void {
    listComponent.loadStudents();
    this.editingStudent = null;
  }

  onEditStudent(student: Student): void {
    this.editingStudent = student;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
