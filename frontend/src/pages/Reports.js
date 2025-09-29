import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  CircularProgress,
  useTheme,
  useMediaQuery,
  Paper,
  Divider,
} from '@mui/material';
import {
  Download,
  PictureAsPdf,
  CalendarMonth
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  Filler,
} from 'chart.js';
import { motion } from 'framer-motion';
import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import * as ApiService from '../services/api';
import { formatCurrency, getDateRange, expenseCategories, chartColors, exportToCSV } from '../utils/helpers';
import { useUser } from '../contexts/UserContext';
import { useErrorHandler } from '../utils/errorHandler';
import ErrorAlert from '../components/ErrorAlert';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  Filler
);

// Custom Icon Component for dashboard cards
const DashboardIcon = ({ src, alt }) => (
  <img
    src={src}
    alt={alt}
    style={{
      width: 32,
      height: 32,
      // No filter applied to keep original colors
      opacity: 0.9,
    }}
  />
);

const Reports = () => {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('month');
  const [customDate, setCustomDate] = useState({
    startDate: null,
    endDate: null
  });
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const { error, handleError, clearError } = useErrorHandler();
  const [reportData, setReportData] = useState({});
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { userProfile } = useUser();

  useEffect(() => {
    // Only fetch immediately for non-custom periods
    if (period !== 'custom') {
      fetchReportData();
      return;
    }
    
    // For custom period, only fetch when both dates are complete
    if (period === 'custom' && customDate.startDate && customDate.endDate) {
      fetchReportData();
    }
  }, [period, userProfile.currency]); // Remove date dependencies to prevent premature loading

  // Function to manually trigger fetch when both dates are selected
  const handleDateSelectionComplete = useCallback(() => {
    if (period === 'custom' && customDate.startDate && customDate.endDate) {
      fetchReportData();
    }
  }, [period, customDate.startDate, customDate.endDate]);

  useEffect(() => {
    // Listen for data changes from other components
    const handleDataUpdate = () => {
      fetchReportData();
    };

    window.addEventListener('expenseAdded', handleDataUpdate);
    window.addEventListener('expenseUpdated', handleDataUpdate);
    window.addEventListener('expenseDeleted', handleDataUpdate);
    window.addEventListener('budgetAdded', handleDataUpdate);
    window.addEventListener('budgetUpdated', handleDataUpdate);
    window.addEventListener('budgetDeleted', handleDataUpdate);
    window.addEventListener('currencyChanged', handleDataUpdate); // Listen for currency changes

    return () => {
      window.removeEventListener('expenseAdded', handleDataUpdate);
      window.removeEventListener('expenseUpdated', handleDataUpdate);
      window.removeEventListener('expenseDeleted', handleDataUpdate);
      window.removeEventListener('budgetAdded', handleDataUpdate);
      window.removeEventListener('budgetUpdated', handleDataUpdate);
      window.removeEventListener('budgetDeleted', handleDataUpdate);
      window.removeEventListener('currencyChanged', handleDataUpdate); // Clean up currency listener
    };
  }, []);

  const fetchReportData = async () => {
    try {
      setLoading(true);
      
      // Don't fetch if custom date range is selected but dates aren't set
      if (period === 'custom' && (!customDate.startDate || !customDate.endDate)) {
        setExpenses([]);
        setBudgets([]);
        setReportData({
          totalSpent: 0,
          categoryTotals: {},
          dailyTotals: {},
          transactionCount: 0,
          averageTransaction: 0
        });
        setLoading(false);
        return;
      }

      let dateRange;
      if (period === 'all') {
        // For 'all' period, use user's account creation date or a very early date
        dateRange = {
          startDate: userProfile.createdAt ? new Date(userProfile.createdAt) : new Date('2000-01-01'),
          endDate: customDate.endDate || new Date()
        };
      } else if (period === 'custom') {
        dateRange = { startDate: customDate.startDate, endDate: customDate.endDate };
      } else {
        dateRange = getDateRange(period);
      }
      
      const expensesResponse = await ApiService.getExpenses({
        startDate: dateRange.startDate.toISOString().split('T')[0],
        endDate: dateRange.endDate.toISOString().split('T')[0],
      });

      const budgetsResponse = await ApiService.getBudgets();

      setExpenses(expensesResponse || []);
      setBudgets(budgetsResponse || []);

      // Process data for reports
      const data = processReportData(expensesResponse || []);
      setReportData(data);

    } catch (error) {
      console.error('Error fetching report data:', error);
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const processReportData = (expenses) => {
    const categoryTotals = {};
    const dailyTotals = {};
    let totalSpent = 0;

    expenses.forEach(expense => {
      const amount = parseFloat(expense.amount);
      totalSpent += amount;

      // Category totals
      categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + amount;

      // Daily totals
      const date = new Date(expense.date).toLocaleDateString();
      dailyTotals[date] = (dailyTotals[date] || 0) + amount;
    });

    return {
      totalSpent,
      categoryTotals,
      dailyTotals,
      transactionCount: expenses.length,
      averageTransaction: expenses.length > 0 ? totalSpent / expenses.length : 0,
    };
  };

  const getCategoryChartData = () => {
    const categories = Object.keys(reportData.categoryTotals || {});
    return {
      labels: categories.map(cat => expenseCategories[cat]?.name || cat),
      datasets: [{
        data: Object.values(reportData.categoryTotals || {}),
        backgroundColor: chartColors.slice(0, categories.length),
        borderWidth: 2,
        borderColor: theme.palette.background.paper,
      }]
    };
  };

  const getDailyTrendData = () => {
    const sortedDates = Object.keys(reportData.dailyTotals || {}).sort();
    return {
      labels: sortedDates,
      datasets: [{
        label: 'Daily Spending',
        data: sortedDates.map(date => reportData.dailyTotals[date]),
        borderColor: theme.palette.primary.main,
        backgroundColor: theme.palette.primary.main + '20',
        tension: 0.4,
        fill: true,
      }]
    };
  };

  const getTopCategoriesData = () => {
    const sortedCategories = Object.entries(reportData.categoryTotals || {})
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);

    return {
      labels: sortedCategories.map(([cat]) => expenseCategories[cat]?.name || cat),
      datasets: [{
        label: 'Amount Spent',
        data: sortedCategories.map(([,amount]) => amount),
        backgroundColor: chartColors.slice(0, sortedCategories.length),
        borderRadius: 8,
      }]
    };
  };

  const exportToPDF = async () => {
    try {
      console.log('📄 Starting PDF export...');
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      let yPos = 20;

      // Add logo (ensure logo.png is in public folder)
      const logoImg = new window.Image();
      logoImg.src = '/logo.png';
      logoImg.onload = async () => {
        // Calculate logo size (max 40x40, keep aspect ratio)
        let logoWidth = 40;
        let logoHeight = 40;
        if (logoImg.width > logoImg.height) {
          logoHeight = (logoImg.height / logoImg.width) * logoWidth;
        } else {
          logoWidth = (logoImg.width / logoImg.height) * logoHeight;
        }
        pdf.addImage(logoImg, 'PNG', pageWidth / 2 - logoWidth / 2, 10, logoWidth, logoHeight);
        yPos = 10 + logoHeight + 10;

        // Title
        pdf.setFontSize(20);
        pdf.setTextColor(32, 70, 140); // Blue shade for title
        pdf.setFont(undefined, 'bold');
        pdf.text('FinSight AI - Expense Report', pageWidth / 2, yPos, { align: 'center' });
        yPos += 15;

        // Report Period
        pdf.setFontSize(12);
        pdf.setTextColor(60, 60, 60);
        pdf.setFont(undefined, 'normal');
        const formatDate = (date) => {
          return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          });
        };

        let dateRange;
        if (period === 'all') {
          dateRange = {
            startDate: userProfile.createdAt ? new Date(userProfile.createdAt) : new Date('2000-01-01'),
            endDate: new Date()
          };
        } else if (period === 'custom') {
          dateRange = { startDate: customDate.startDate, endDate: customDate.endDate };
        } else {
          dateRange = getDateRange(period);
        }

        let periodText = '';
        if (period === 'custom' || period === 'all') {
          periodText = `Period: ${formatDate(dateRange.startDate)} to ${formatDate(dateRange.endDate)}`;
        } else {
          periodText = `Period: ${period.charAt(0).toUpperCase() + period.slice(1)} (${formatDate(dateRange.startDate)} to ${formatDate(dateRange.endDate)})`;
        }
        pdf.text(periodText, 20, yPos);
        yPos += 20;

        // Summary Section
        pdf.setFontSize(14);
        pdf.setTextColor(32, 70, 140); // Blue shade for section header
        pdf.setFont(undefined, 'bold');
        pdf.text('Summary', 20, yPos);
        pdf.setDrawColor(32, 70, 140);
        pdf.setLineWidth(0.7);
        pdf.line(20, yPos + 2, pageWidth - 20, yPos + 2);
        yPos += 10;

  // Summary values in colored boxes
  pdf.setFillColor(230, 240, 255); // Light blue
  pdf.rect(20, yPos, pageWidth - 40, 24, 'F');
  pdf.setFontSize(11);
  pdf.setTextColor(32, 70, 140); // Blue for text
  pdf.setFont(undefined, 'bold');
  pdf.text(`Total Spent: ${formatCurrency(reportData.totalSpent, userProfile.currency)}`, 25, yPos + 8);
  pdf.setTextColor(60, 60, 60); // Gray-black for contrast
  pdf.text(`Total Transactions: ${reportData.transactionCount}`, 25, yPos + 16);
  pdf.setTextColor(32, 70, 140); // Blue for text
  pdf.text(`Average Transaction: ${formatCurrency(reportData.averageTransaction, userProfile.currency)}`, pageWidth / 2 + 10, yPos + 8);
  yPos += 30;

        // Category Breakdown Section
        pdf.setFontSize(14);
        pdf.setTextColor(32, 70, 140);
        pdf.setFont(undefined, 'bold');
        pdf.text('Category Breakdown', 20, yPos);
        pdf.setDrawColor(32, 70, 140);
        pdf.setLineWidth(0.7);
        pdf.line(20, yPos + 2, pageWidth - 20, yPos + 2);
        yPos += 10;

        Object.entries(reportData.categoryTotals || {}).forEach(([category, amount], idx) => {
          const categoryName = expenseCategories[category]?.name || category;
          // Category header with blue accent
          pdf.setFillColor(220, 230, 250); // Soft blue
          pdf.rect(20, yPos, pageWidth - 40, 12, 'F');
          pdf.setFontSize(12);
          pdf.setTextColor(32, 70, 140);
          pdf.setFont(undefined, 'bold');
          pdf.text(`${categoryName} (${formatCurrency(amount, userProfile.currency)})`, 25, yPos + 9);
          yPos += 16;

          // Table header
          pdf.setFontSize(10);
          pdf.setTextColor(30, 64, 175);
          pdf.setFont(undefined, 'bold');
          pdf.text('Description', 30, yPos);
          pdf.text('Amount', pageWidth / 2, yPos);
          pdf.text('Date', pageWidth - 50, yPos);
          yPos += 6;
          pdf.setDrawColor(32, 70, 140);
          pdf.setLineWidth(0.3);
          pdf.line(25, yPos, pageWidth - 25, yPos);
          yPos += 2;

          // Table rows
          pdf.setFontSize(9);
          pdf.setFont(undefined, 'normal');
          expenses
            .filter(exp => exp.category === category)
            .forEach(exp => {
              const expDate = new Date(exp.date);
              const dateStr = `${expDate.getDate().toString().padStart(2, '0')}-${(expDate.getMonth()+1).toString().padStart(2, '0')}-${expDate.getFullYear()}`;
              // Alternate row color for eye-catching effect
              if ((yPos / 7) % 2 < 1) {
                pdf.setFillColor(245, 248, 255); // Very light blue
                pdf.rect(25, yPos - 2, pageWidth - 50, 7, 'F');
              }
              pdf.setTextColor(40, 40, 40);
              pdf.text(exp.description || '-', 30, yPos + 4);
              pdf.text(formatCurrency(exp.amount, userProfile.currency), pageWidth / 2, yPos + 4, { align: 'center' });
              pdf.text(dateStr, pageWidth - 50, yPos + 4);
              yPos += 8;
              if (yPos > 270) {
                pdf.addPage();
                yPos = 20;
              }
            });
          yPos += 10;
          if (yPos > 270) {
            pdf.addPage();
            yPos = 20;
          }
        });

        // Add some padding at the bottom of the last page
        pdf.setFontSize(10);

        // Save PDF
        const getFilenameDatePart = () => {
          if (period === 'custom') {
            const start = customDate.startDate.toISOString().split('T')[0];
            const end = customDate.endDate.toISOString().split('T')[0];
            return `${start}_to_${end}`;
          } else if (period === 'all') {
            return 'all-time';
          }
          return period;
        };

        const filename = `finsight-report-${getFilenameDatePart()}.pdf`;

        // Check if we're on mobile (Capacitor)
        if (Capacitor.isNativePlatform()) {
          // Mobile: Use Capacitor Filesystem
          try {
            const pdfData = pdf.output('datauristring').split(',')[1]; // Get base64 data

            await Filesystem.writeFile({
              path: filename,
              data: pdfData,
              directory: Directory.Documents,
              encoding: Encoding.UTF8,
            });

            alert(`✅ PDF exported successfully to Documents/${filename}`);
            console.log('✅ Mobile PDF export completed:', filename);
          } catch (fsError) {
            console.error('❌ Mobile filesystem write failed:', fsError);
            // Fallback to browser method
            pdf.save(filename);
          }
        } else {
          // Desktop: Use browser download
          pdf.save(filename);
          console.log('✅ Desktop PDF export completed:', filename);
        }
      }; // Close logoImg.onload function
    } catch (error) {
      console.error('❌ PDF export failed:', error);
      handleError(error);
    }
  };

  const exportToCSVReport = () => {
    try {
      console.log('📊 Starting CSV export with', expenses.length, 'expenses...');
      
      if (!expenses || expenses.length === 0) {
        alert('No expenses to export for the selected period');
        return;
      }
      
      const csvData = expenses.map(expense => ({
        Date: expense.date,
        Description: expense.description,
        Category: expenseCategories[expense.category]?.name || expense.category,
        Amount: expense.amount,
        Notes: expense.notes || '',
      }));
      
      exportToCSV(csvData, `finsight-expenses-${period}-${new Date().toISOString().split('T')[0]}.csv`);
    } catch (error) {
      console.error('❌ CSV export failed:', error);
      handleError(error);
    }
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: isMobile ? 'bottom' : 'right',
        labels: {
          padding: 15,
          usePointStyle: true,
        },
      },
    },
  };

  const lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function(value) {
            return formatCurrency(value, userProfile.currency);
          }
        }
      }
    },
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress size={40} />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 3 }}>
          Reports & Analytics
        </Typography>

        <ErrorAlert error={error} />

        {/* Controls */}
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Box sx={{ 
                display: 'flex', 
                flexDirection: { xs: 'column', sm: 'row' }, 
                gap: 2,
                alignItems: { xs: 'stretch', sm: 'flex-start' }
              }}>
                <FormControl fullWidth>
                  <InputLabel>Time Period</InputLabel>
                  <Select
                    value={period}
                    label="Time Period"
                    onChange={(e) => {
                      setPeriod(e.target.value);
                      if (e.target.value !== 'custom') {
                        setCustomDate({ startDate: null, endDate: null });
                      }
                    }}
                  >
                    <MenuItem value="today">Today</MenuItem>
                    <MenuItem value="week">This Week</MenuItem>
                    <MenuItem value="month">This Month</MenuItem>
                    <MenuItem value="lastMonth">Last Month</MenuItem>
                    <MenuItem value="year">This Year</MenuItem>
                    <MenuItem value="lastYear">Last Year</MenuItem>
                    <MenuItem value="custom">Custom Date Range</MenuItem>
                    <MenuItem value="all">All Time</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: { xs: 'stretch', sm: 'flex-start' } }}>
                  <Button
                    variant="outlined"
                    startIcon={<Download />}
                    onClick={exportToCSVReport}
                    size="small"
                    sx={{ flex: { xs: '1 1 auto', sm: '0 0 auto' } }}
                  >
                    Export CSV
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<PictureAsPdf />}
                    onClick={exportToPDF}
                    size="small"
                    sx={{ flex: { xs: '1 1 auto', sm: '0 0 auto' } }}
                  >
                    Export PDF
                  </Button>
                </Box>
              </Box>
              {period === 'custom' && (
                <Box>
                  <Box sx={{ 
                    display: 'flex', 
                    gap: 2, 
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'stretch', sm: 'flex-end' }
                  }}>
                  <DatePicker
                    label="Start Date"
                    value={customDate.startDate}
                    onChange={(newValue) => {
                      setCustomDate(prev => ({ ...prev, startDate: newValue }));
                    }}
                    format="dd/MM/yyyy"
                    views={['year', 'month', 'day']}
                    openTo="year"
                    maxDate={new Date()} // Prevent selection of future dates
                    slotProps={{
                      textField: { 
                        fullWidth: true,
                        placeholder: "Select year/month/date",
                        sx: { '& .MuiInputBase-input': { fontSize: '1.1rem' } }
                      },
                      actionBar: { 
                        actions: ['clear']
                      },
                      layout: { 
                        sx: { width: '320px' }
                      },
                      popper: {
                        sx: { 
                          '& .MuiPickersCalendarHeader-root': { order: 3 },
                          '& .MuiYearCalendar-root': { order: 1 },
                          '& .MuiMonthCalendar-root': { order: 2 },
                          '& .MuiDayCalendar-root': { order: 4 }
                        }
                      },
                      field: {
                        readOnly: false
                      }
                    }}
                  />
                  <DatePicker
                    label="End Date"
                    value={customDate.endDate}
                    onChange={(newValue) => {
                      setCustomDate(prev => ({ ...prev, endDate: newValue }));
                    }}
                    format="dd/MM/yyyy"
                    views={['year', 'month', 'day']}
                    openTo="year"
                    minDate={customDate.startDate || null}
                    maxDate={new Date()} // Prevent selection of future dates
                    slotProps={{
                      textField: { 
                        fullWidth: true,
                        placeholder: "Select year/month/date",
                        sx: { '& .MuiInputBase-input': { fontSize: '1.1rem' } }
                      },
                      actionBar: { 
                        actions: ['clear']
                      },
                      layout: { 
                        sx: { width: '320px' }
                      },
                      popper: {
                        sx: { 
                          '& .MuiPickersCalendarHeader-root': { order: 3 },
                          '& .MuiYearCalendar-root': { order: 1 },
                          '& .MuiMonthCalendar-root': { order: 2 },
                          '& .MuiDayCalendar-root': { order: 4 }
                        }
                      },
                      field: {
                        readOnly: false
                      }
                    }}
                  />
                  <Button
                    variant="contained"
                    onClick={handleDateSelectionComplete}
                    disabled={!customDate.startDate || !customDate.endDate}
                    sx={{ 
                      alignSelf: { xs: 'stretch', sm: 'flex-end' },
                      height: '56px', // Match DatePicker height
                      minWidth: '120px'
                    }}
                  >
                    Apply
                  </Button>
                  </Box>
                  {customDate.startDate && customDate.endDate && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                      Selected: {customDate.startDate.toLocaleDateString()} to {customDate.endDate.toLocaleDateString()}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 2, sm: 3 } }}>
            {/* Total Spent Card */}
            <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 25%' } }}>
              <motion.div whileHover={{ scale: 1.02 }} transition={{ duration: 0.2 }}>
                <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)', minHeight: { xs: 120, sm: 140 } }}>
                  <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 2.5 }, height: '100%', display: 'flex', alignItems: 'center' }}>
                    <Box 
                      display="flex" 
                      width="100%" 
                      sx={{ 
                        flexDirection: { xs: 'row', md: 'column' },
                        alignItems: { xs: 'center', md: 'flex-start' },
                        gap: { xs: 1, md: 1.5 }
                      }}
                    >
                      <Box sx={{ 
                        flexShrink: 0, 
                        display: 'flex', 
                        alignItems: 'center',
                        justifyContent: 'center',
                        order: { xs: 2, md: 1 }
                      }}>
                        <DashboardIcon src="/total-spent-icon.png" alt="Total Spent" />
                      </Box>
                      <Box sx={{ 
                        flex: '1 1 0%', 
                        minWidth: 0,
                        order: { xs: 1, md: 2 }
                      }}>
                        <Typography color="white" variant="body2" sx={{ opacity: 0.8, fontSize: { xs: '0.7rem', sm: '0.8rem' }, mb: 0.5 }}>
                          Total Spent
                        </Typography>
                        <Typography 
                          variant="h5" 
                          color="white" 
                          fontWeight={600}
                          sx={{ 
                            fontSize: { xs: '0.85rem', sm: '1rem', md: '1.2rem' }, 
                            fontWeight: 700,
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {formatCurrency(reportData.totalSpent, userProfile.currency)}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </motion.div>
            </Box>

            {/* Transactions Card */}
            <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 25%' } }}>
              <motion.div whileHover={{ scale: 1.02 }} transition={{ duration: 0.2 }}>
                <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)', minHeight: { xs: 120, sm: 140 } }}>
                  <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 2.5 }, height: '100%', display: 'flex', alignItems: 'center' }}>
                    <Box 
                      display="flex" 
                      width="100%" 
                      sx={{ 
                        flexDirection: { xs: 'row', md: 'column' },
                        alignItems: { xs: 'center', md: 'flex-start' },
                        gap: { xs: 1, md: 1.5 }
                      }}
                    >
                      <Box sx={{ 
                        flexShrink: 0, 
                        display: 'flex', 
                        alignItems: 'center',
                        justifyContent: 'center',
                        order: { xs: 2, md: 1 }
                      }}>
                        <DashboardIcon src="/transaction-icons.png" alt="Transactions" />
                      </Box>
                      <Box sx={{ 
                        flex: '1 1 0%', 
                        minWidth: 0,
                        order: { xs: 1, md: 2 }
                      }}>
                        <Typography color="white" variant="body2" sx={{ opacity: 0.8, fontSize: { xs: '0.7rem', sm: '0.8rem' }, mb: 0.5 }}>
                          Transactions
                        </Typography>
                        <Typography 
                          variant="h5" 
                          color="white" 
                          fontWeight={600}
                          sx={{ 
                            fontSize: { xs: '0.85rem', sm: '1rem', md: '1.2rem' }, 
                            fontWeight: 700,
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {reportData.transactionCount}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </motion.div>
            </Box>

            {/* Average Transaction Card */}
            <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 25%' } }}>
              <motion.div whileHover={{ scale: 1.02 }} transition={{ duration: 0.2 }}>
                <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)', minHeight: { xs: 120, sm: 140 } }}>
                  <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 2.5 }, height: '100%', display: 'flex', alignItems: 'center' }}>
                    <Box 
                      display="flex" 
                      width="100%" 
                      sx={{ 
                        flexDirection: { xs: 'row', md: 'column' },
                        alignItems: { xs: 'center', md: 'flex-start' },
                        gap: { xs: 1, md: 1.5 }
                      }}
                    >
                      <Box sx={{ 
                        flexShrink: 0, 
                        display: 'flex', 
                        alignItems: 'center',
                        justifyContent: 'center',
                        order: { xs: 2, md: 1 }
                      }}>
                        <DashboardIcon src="/average-daily-icon.png" alt="Average Transaction" />
                      </Box>
                      <Box sx={{ 
                        flex: '1 1 0%', 
                        minWidth: 0,
                        order: { xs: 1, md: 2 }
                      }}>
                        <Typography color="white" variant="body2" sx={{ opacity: 0.8, fontSize: { xs: '0.7rem', sm: '0.8rem' }, mb: 0.5 }}>
                          Avg. Transaction
                        </Typography>
                        <Typography 
                          variant="h5" 
                          color="white" 
                          fontWeight={600}
                          sx={{ 
                            fontSize: { xs: '0.85rem', sm: '1rem', md: '1.2rem' }, 
                            fontWeight: 700,
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {formatCurrency(reportData.averageTransaction, userProfile.currency)}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </motion.div>
            </Box>

            {/* Categories Card */}
            <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 25%' } }}>
              <motion.div whileHover={{ scale: 1.02 }} transition={{ duration: 0.2 }}>
                <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)', minHeight: { xs: 120, sm: 140 } }}>
                  <CardContent sx={{ p: { xs: 1.5, sm: 2, md: 2.5 }, height: '100%', display: 'flex', alignItems: 'center' }}>
                    <Box 
                      display="flex" 
                      width="100%" 
                      sx={{ 
                        flexDirection: { xs: 'row', md: 'column' },
                        alignItems: { xs: 'center', md: 'flex-start' },
                        gap: { xs: 1, md: 1.5 }
                      }}
                    >
                      <Box sx={{ 
                        flexShrink: 0, 
                        display: 'flex', 
                        alignItems: 'center',
                        justifyContent: 'center',
                        order: { xs: 2, md: 1 }
                      }}>
                        <img
                          src="/categories.png"
                          alt="Categories"
                          style={{
                            width: 32,
                            height: 32,
                            // No filter applied to keep original colors
                          }}
                        />
                      </Box>
                      <Box sx={{ 
                        flex: '1 1 0%', 
                        minWidth: 0,
                        order: { xs: 1, md: 2 }
                      }}>
                        <Typography color="white" variant="body2" sx={{ opacity: 0.8, fontSize: { xs: '0.7rem', sm: '0.8rem' }, mb: 0.5 }}>
                          Categories
                        </Typography>
                        <Typography 
                          variant="h5" 
                          color="white" 
                          fontWeight={600}
                          sx={{ 
                            fontSize: { xs: '0.85rem', sm: '1rem', md: '1.2rem' }, 
                            fontWeight: 700,
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {Object.keys(reportData.categoryTotals || {}).length}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </motion.div>
            </Box>
          </Box>
        </Box>

        {/* Charts */}
        {expenses.length > 0 ? (
          <Box sx={{ mb: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: { xs: 3, lg: 3 } }}>
              <Box sx={{ flex: { xs: '1 1 100%', lg: '1 1 50%' } }}>
                <Card sx={{ height: 400 }}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom fontWeight={600}>
                      Spending by Category
                    </Typography>
                    <Box sx={{ height: 300, position: 'relative' }}>
                      <Doughnut data={getCategoryChartData()} options={chartOptions} />
                    </Box>
                  </CardContent>
                </Card>
              </Box>

              <Box sx={{ flex: { xs: '1 1 100%', lg: '1 1 50%' } }}>
                <Card sx={{ height: 400 }}>
                  <CardContent>
                    <Typography variant="h6" gutterBottom fontWeight={600}>
                      Top Categories
                    </Typography>
                    <Box sx={{ height: 300, position: 'relative' }}>
                      <Bar data={getTopCategoriesData()} options={lineChartOptions} />
                    </Box>
                  </CardContent>
                </Card>
              </Box>
            </Box>

            <Box sx={{ mt: 3 }}>
              <Card sx={{ height: 400 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom fontWeight={600}>
                    Spending Trend
                  </Typography>
                  <Box sx={{ height: 300, position: 'relative' }}>
                    <Line data={getDailyTrendData()} options={lineChartOptions} />
                  </Box>
                </CardContent>
              </Card>
            </Box>
          </Box>
        ) : (
          <Paper sx={{ p: 6, textAlign: 'center' }}>
            <img
              src="/report.png"
              alt="No data"
              style={{
                width: 64,
                height: 64,
                opacity: 0.5,
                marginBottom: 16,
              }}
            />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No data available for selected period
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add some expenses to see your analytics and reports
            </Typography>
          </Paper>
        )}

        {/* Category Breakdown Table */}
        {Object.keys(reportData.categoryTotals || {}).length > 0 && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom fontWeight={600}>
                Category Breakdown
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {Object.entries(reportData.categoryTotals)
                .sort(([,a], [,b]) => b - a)
                .map(([category, amount], index) => {
                  const categoryInfo = expenseCategories[category] || { name: category, icon: '📝' };
                  const percentage = (amount / reportData.totalSpent) * 100;
                  
                  return (
                    <Box key={category} sx={{ mb: 2 }}>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Box display="flex" alignItems="center">
                          <Box sx={{ mr: 1, fontSize: '20px' }}>{categoryInfo.icon}</Box>
                          <Typography variant="body1" fontWeight={500}>
                            {categoryInfo.name}
                          </Typography>
                        </Box>
                        <Box textAlign="right">
                          <Typography variant="body1" fontWeight={600}>
                            {formatCurrency(amount, userProfile.currency)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {percentage.toFixed(1)}%
                          </Typography>
                        </Box>
                      </Box>
                      <Box
                        sx={{
                          height: 8,
                          backgroundColor: theme.palette.grey[200],
                          borderRadius: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          sx={{
                            height: '100%',
                            width: `${percentage}%`,
                            backgroundColor: chartColors[index % chartColors.length],
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </Box>
                    </Box>
                  );
                })}
            </CardContent>
          </Card>
        )}
      </motion.div>
    </Box>
  );
};

export default Reports;