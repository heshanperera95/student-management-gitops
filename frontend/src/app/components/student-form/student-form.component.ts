import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StudentService } from '../../services/student.service';
import { Student } from '../../models/student.model';

@Component({
  selector: 'app-student-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-form.component.html',
  styleUrls: ['./student-form.component.css']
})
export class StudentFormComponent implements OnChanges {
  @Input() editingStudent: Student | null = null;
  @Output() studentSaved = new EventEmitter<void>();

  form: Student = { id: '', name: '', email: '', phone: '' };
  isEditing = false;
  errorMessage = '';
  successMessage = '';

  constructor(private studentService: StudentService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editingStudent'] && this.editingStudent) {
      this.form = { ...this.editingStudent };
      this.isEditing = true;
      this.errorMessage = '';
      this.successMessage = '';
    }
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.form.id || !this.form.name || !this.form.email || !this.form.phone) {
      this.errorMessage = 'All fields are required.';
      return;
    }

    if (this.isEditing) {
      this.studentService.update(this.form.id, this.form).subscribe({
        next: () => {
          this.successMessage = 'Student updated successfully.';
          this.reset();
          this.studentSaved.emit();
        },
        error: (err) => {
          this.errorMessage = err.error?.error || 'Failed to update student.';
        }
      });
    } else {
      this.studentService.create(this.form).subscribe({
        next: () => {
          this.successMessage = 'Student added successfully.';
          this.reset();
          this.studentSaved.emit();
        },
        error: (err) => {
          this.errorMessage = err.error?.error || 'Failed to add student.';
        }
      });
    }
  }

  onCancel(): void {
    this.reset();
  }

  private reset(): void {
    this.form = { id: '', name: '', email: '', phone: '' };
    this.isEditing = false;
    this.editingStudent = null;
  }
}
