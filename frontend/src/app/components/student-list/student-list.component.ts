import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StudentService } from '../../services/student.service';
import { Student } from '../../models/student.model';

@Component({
  selector: 'app-student-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './student-list.component.html',
  styleUrls: ['./student-list.component.css']
})
export class StudentListComponent {
  @Output() editStudent = new EventEmitter<Student>();

  students: Student[] = [];
  errorMessage = '';
  successMessage = '';
  loaded = false;
  loading = false;

  constructor(private studentService: StudentService) {}

  loadStudents(): void {
    this.loading = true;
    this.errorMessage = '';
    this.studentService.getAll().subscribe({
      next: (data) => {
        this.students = data;
        this.loaded = true;
        this.loading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load students.';
        this.loading = false;
      }
    });
  }

  onEdit(student: Student): void {
    this.editStudent.emit(student);
  }

  onDelete(id: string): void {
    if (!confirm('Delete this student?')) return;
    this.studentService.delete(id).subscribe({
      next: () => {
        this.successMessage = 'Student deleted.';
        this.loadStudents();
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: () => (this.errorMessage = 'Failed to delete student.')
    });
  }
}
