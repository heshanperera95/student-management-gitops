from flask import Flask, jsonify, request
from flask_cors import CORS
from prometheus_flask_exporter import PrometheusMetrics

app = Flask(__name__)
CORS(app)
metrics = PrometheusMetrics(app)

# Static app info metric
metrics.info('student_management_app_info', 'Student Management API', version='1.3.0')

VERSION = "1.3.0"

# In-memory storage (data resets on pod restart — fine for testing)
students = {}


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})


@app.route("/version", methods=["GET"])
def version():
    return jsonify({"version": VERSION})


@app.route("/students", methods=["GET"])
def get_students():
    return jsonify(list(students.values()))


@app.route("/students/<student_id>", methods=["GET"])
def get_student(student_id):
    student = students.get(student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404
    return jsonify(student)


@app.route("/students", methods=["POST"])
def create_student():
    data = request.get_json()
    required_fields = ["id", "name", "email", "phone"]

    if not data or not all(k in data for k in required_fields):
        return jsonify({"error": "Missing required fields: id, name, email, phone"}), 400

    if not data["id"].strip():
        return jsonify({"error": "Student ID cannot be empty"}), 400

    if data["id"] in students:
        return jsonify({"error": "Student ID already exists"}), 409

    student = {
        "id": data["id"].strip(),
        "name": data["name"].strip(),
        "email": data["email"].strip(),
        "phone": data["phone"].strip(),
    }
    students[student["id"]] = student
    return jsonify(student), 201


@app.route("/students/<student_id>", methods=["PUT"])
def update_student(student_id):
    if student_id not in students:
        return jsonify({"error": "Student not found"}), 404

    data = request.get_json()
    students[student_id].update({
        "name": data.get("name", students[student_id]["name"]).strip(),
        "email": data.get("email", students[student_id]["email"]).strip(),
        "phone": data.get("phone", students[student_id]["phone"]).strip(),
    })
    return jsonify(students[student_id])


@app.route("/students/<student_id>", methods=["DELETE"])
def delete_student(student_id):
    if student_id not in students:
        return jsonify({"error": "Student not found"}), 404
    del students[student_id]
    return jsonify({"message": "Student deleted successfully"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
