# ⚡ OhmFlow v2

**OhmFlow** is a modern, mobile-first web application designed for electricians and construction teams to manage sites (chantiers), track hours/materials, and organize team planning.

![OhmFlow Banner](https://images.unsplash.com/photo-1621905251189-08b45d6a269e?q=80&w=2069&auto=format&fit=crop)

## 🚀 Key Features

### 🏗️ Chantier Management
- **Detailed View**: Access all site info (dates, addresses, remarks) in one place.
- **Team Assignment**: Assign specific team members to sites.
- **Alerts**: Set and track due dates or important reminders.
- **Documents**: (Upcoming) Store PDFs and site plans.

### ⏱️ Time & Material Tracking (Saisie)
- **Fast Entry**: Unified form to log hours and material costs in seconds.
- **Delegation Mode**: Admins can log entries on behalf of other team members.
- **Validation**: Admin-only view to validate or reject daily entries.

### 📅 Planning & Leaves
- **Global Calendar**: Visual overview of team availability.
- **Leave Requests**: Users can request Vacation, Sickness, or Other leaves.
- **Approval Workflow**: Admins review and approve/reject leave requests.

### 🔒 Administration
- **User Management**: Create/Edit users, assign PINs and Roles (Admin/User).
- **Data Export**: Export all entry data to CSV for accounting.

---

## 🛠️ Technical Stack
- **Frontend**: React (Vite), TailwindCSS, Lucide Icons.
- **Backend**: Python Flask, SQLite, SQLAlchemy.
- **Infrastructure**: Docker & Docker Compose.

---

## 💻 How to Work on This Project (Git Workflow)

### 1. Setup / First Time
Open your terminal (Command Prompt/PowerShell/Terminal) and run:

```bash
# Clone the repository to your computer
git clone https://github.com/ricc187/OHM-FLOWv2.git

# Enter the folder
cd OHM-FLOWv2
```

### 2. Run the Application
We use Docker to run everything with one command:

```bash
docker-compose up --build
```
> Access the app at: http://localhost:80

### 3. Daily Workflow (Pull -> Edit -> Push)

**Step A: Get latest changes**
Before starting work, always pull the latest version:
```bash
git pull
```

**Step B: Make your changes**
Edit the code files on your computer.

**Step C: Save and Share (Push)**
When you are happy with your changes:

```bash
# 1. Add all modified files
git add .

# 2. Save them with a message (describe what you did)
git commit -m "Added new feature X"

# 3. Send to GitHub
git push
```

---

## 🔧 Troubleshooting

- **Database Issues**: If the database seems stuck, you can delete the `data/` folder and restart docker to reset it (Warning: deletes all data).
- **Rebuild**: If you install new packages or change configuration, always add `--build`:
  ```bash
  docker-compose up --build
  ```
